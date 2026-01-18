// src/controllers/package-recommendation.controller.ts
import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Package } from "../../entity/Package";
import { Company } from "../../entity/Company";
import { Project } from "../../entity/Project";
import { Between, Like, ILike, In, Repository, QueryRunner } from "typeorm";
const { GoogleGenAI } = require("@google/genai");

// Define response interfaces
interface ICreateEventResponse {
    success: boolean;
    message?: string;
    data?: any;
    error?: string;
}

interface IRecommendationRequest {
    query: string;
    companyId?: string;
    maxPrice?: number;
    minPrice?: number;
    location?: string;
    eventType?: string;
    features?: string[];
}

interface IPackageWithScore {
    id: string;
    name: string;
    price: number;
    duration: string;
    features: string[];
    companyName: string;
    companyCountry: string;
    companyEmail: string;
    isPopular: boolean;
    score: number;
    explanation: string;
    matchReasons: string[];
}

class GeminiController {
    private ai: any;

    constructor() {
        if (!process.env.GEMINI_API_KEY) {
            console.error("GEMINI_API_KEY environment variable is not set");
        }

        this.ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY || ""
        });
    }

    public recommendPackages = async (
        req: Request<{}, {}, { query: string }>,
        res: Response<ICreateEventResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { query } = req.body;

            // Validation
            if (!query || query.trim() === "") {
                return res.status(400).json({
                    success: false,
                    message: "Search query is required"
                });
            }

            // Step 1: Parse natural language requirements using AI
            const parsedRequirements = await this.parseRequirements(query);

            // Step 2: Get repositories
            const packageRepo = queryRunner.manager.getRepository(Package);
            const companyRepo = queryRunner.manager.getRepository(Company);

            // Step 3: Build TypeORM query based ONLY on parsed requirements
            const queryBuilder = this.buildPackageQuery(
                packageRepo,
                {
                    eventType: parsedRequirements.eventType,
                    maxPrice: parsedRequirements.maxBudget,
                    minPrice: parsedRequirements.minBudget,
                    location: parsedRequirements.location,
                    features: parsedRequirements.requiredFeatures,
                    // Additional requirements from specialRequirements
                    specialRequirements: parsedRequirements.specialRequirements
                }
            );

            // Step 4: Execute query with relations
            const packages = await queryBuilder.getMany();

            // Step 5: If no packages found, try broader search
            let finalPackages = packages;
            if (packages.length === 0) {
                finalPackages = await this.fallbackSearch(packageRepo, parsedRequirements);
            }

            // Step 6: Rank and score packages
            const rankedPackages = await this.rankPackages(finalPackages, query, parsedRequirements);

            // Step 7: Generate natural language response
            const naturalResponse = await this.generateResponse(rankedPackages, query);

            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Packages found successfully",
                data: {
                    originalQuery: query,
                    parsedRequirements: parsedRequirements,
                    packages: rankedPackages,
                    summary: naturalResponse,
                    totalFound: rankedPackages.length,
                    filtersApplied: {
                        priceRange: {
                            min: parsedRequirements.minBudget,
                            max: parsedRequirements.maxBudget
                        },
                        eventType: parsedRequirements.eventType,
                        features: parsedRequirements.requiredFeatures,
                        location: parsedRequirements.location,
                        duration: parsedRequirements.duration
                    }
                }
            });

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            console.error("Package recommendation error:", error);

            return res.status(500).json({
                success: false,
                message: error.message || "An error occurred while searching for packages",
                error: "Internal server error"
            });
        } finally {
            await queryRunner.release();
        }
    };




    // Step 1: Parse natural language requirements
    private async parseRequirements(query: string): Promise<any> {
        try {
            const prompt = `
Extract package requirements from this user query. Return as JSON.

User Query: "${query}"

Extract:
1. eventType (wedding, corporate, portrait, event, etc.)
2. minBudget (number or null)
3. maxBudget (number or null)
4. requiredFeatures (array of features like: photography, videography, drone, album, editing)
5. duration (string or null)
6. location (string or null)
7. specialRequirements (array of strings)
8. eventDate (Date string in YYYY-MM-DD format or null)
9. dateRange (object with startDate and endDate in YYYY-MM-DD or null)

Return format:
{
  "eventType": "string",
  "minBudget": number|null,
  "maxBudget": number|null,
  "requiredFeatures": ["string"],
  "duration": "string|null",
  "location": "string|null",
  "specialRequirements": ["string"],
  "eventDate": "YYYY-MM-DD"|null,
  "dateRange": {"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}|null
}

If not specified, use null or empty array.
`;

            const result = await this.ai.models.generateContent({
                model: "models/gemini-2.5-flash-lite",
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 500,
                },
            });

            // Try to extract JSON from response
            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            throw new Error("Failed to parse AI response");

        } catch (error) {
            console.error("AI parsing failed, using fallback:", error);
            return this.fallbackParseRequirements(query);
        }
    }

    private fallbackParseRequirements(query: string): any {
        const lowerQuery = query.toLowerCase();
        const requirements = {
            eventType: "general",
            minBudget: null,
            maxBudget: null,
            requiredFeatures: [],
            duration: null,
            location: null,
            specialRequirements: []
        };

        // Event type detection
        if (lowerQuery.includes('wedding')) requirements.eventType = 'wedding';
        else if (lowerQuery.includes('corporate') || lowerQuery.includes('business')) requirements.eventType = 'corporate';
        else if (lowerQuery.includes('portrait') || lowerQuery.includes('portraits')) requirements.eventType = 'portrait';
        else if (lowerQuery.includes('event') || lowerQuery.includes('shoot')) requirements.eventType = 'event';

        // Budget extraction
        const budgetRegex = /\$(\d+)(?:\s*-\s*\$(\d+))?|\$(\d+)\s*(?:and|to)\s*\$(\d+)|under\s*\$(\d+)|less than\s*\$(\d+)|(\d+)\s*dollars?|(\d+)\s*usd/gi;
        let match;

        while ((match = budgetRegex.exec(query)) !== null) {
            const numbers = match.slice(1).filter(n => n).map(n => parseInt(n));
            if (numbers.length > 0) {
                if (match[0].includes('under') || match[0].includes('less than')) {
                    requirements.maxBudget = Math.min(...numbers);
                } else if (numbers.length === 2) {
                    requirements.minBudget = Math.min(...numbers);
                    requirements.maxBudget = Math.max(...numbers);
                } else {
                    requirements.maxBudget = numbers[0];
                }
            }
        }

        // Feature extraction
        const featureKeywords = [
            { keyword: 'photography', feature: 'photography' },
            { keyword: 'video', feature: 'videography' },
            { keyword: 'drone', feature: 'drone' },
            { keyword: 'album', feature: 'album' },
            { keyword: 'edit', feature: 'editing' },
            { keyword: 'candid', feature: 'candid' },
            { keyword: 'traditional', feature: 'traditional' },
            { keyword: 'cinematic', feature: 'cinematic' }
        ];

        featureKeywords.forEach(({ keyword, feature }) => {
            if (lowerQuery.includes(keyword) && !requirements.requiredFeatures.includes(feature)) {
                requirements.requiredFeatures.push(feature);
            }
        });

        return requirements;
    }

    // Step 2 & 3: Build TypeORM query
    private buildPackageQuery(
        packageRepo: Repository<Package>,
        filters: any
    ) {
        const queryBuilder = packageRepo
            .createQueryBuilder('package')
            .leftJoinAndSelect('package.company', 'company')
            .addSelect('company.lockedDates')
            .where('package.status = :status', { status: 'active' });

        // Price filters (from extracted budget)
        if (filters.maxPrice) {
            queryBuilder.andWhere('package.price <= :maxPrice', {
                maxPrice: filters.maxPrice
            });
        }

        if (filters.minPrice) {
            queryBuilder.andWhere('package.price >= :minPrice', {
                minPrice: filters.minPrice
            });
        }

        // Location filter (from extracted location)
        if (filters.location) {
            queryBuilder.andWhere('company.country ILIKE :location', {
                location: `%${filters.location}%`
            });
        }

        // Event type filter (from extracted eventType)
        if (filters.eventType && filters.eventType !== 'general') {
            const eventTypes = filters.eventType.split(' '); // Handle multi-word event types
            const orConditions = eventTypes.map((type: string, index: number) =>
                `package.name ILIKE :eventType${index}`
            ).join(' OR ');

            eventTypes.forEach((type: string, index: number) => {
                queryBuilder.setParameter(`eventType${index}`, `%${type}%`);
            });

            queryBuilder.andWhere(`(${orConditions})`);
        }

        // Features filter (from extracted requiredFeatures)
        if (filters.features && filters.features.length > 0) {
            // Create OR conditions for each feature
            const featureConditions = filters.features.map((feature: string, index: number) => {
                const paramName = `feature${index}`;
                queryBuilder.setParameter(paramName, `%${feature}%`);
                return `package.features::text ILIKE :${paramName}`;
            }).join(' OR ');

            queryBuilder.andWhere(`(${featureConditions})`);
        }

        // Duration filter (from extracted duration)
        if (filters.duration) {
            // Assuming duration might be in package description or features
            queryBuilder.andWhere('package.duration ILIKE :duration OR package.features::text ILIKE :duration', {
                duration: `%${filters.duration}%`
            });
        }

        // Special requirements (from extracted specialRequirements)
        if (filters.specialRequirements && filters.specialRequirements.length > 0) {
            const specialConditions = filters.specialRequirements.map((req: string, index: number) => {
                const paramName = `special${index}`;
                queryBuilder.setParameter(paramName, `%${req}%`);
                return `package.name ILIKE :${paramName} OR package.features::text ILIKE :${paramName}`;
            }).join(' OR ');

            queryBuilder.andWhere(`(${specialConditions})`);
        }

        // Order by relevance (popularity and price)
        queryBuilder
            .orderBy('package.isPopular', 'DESC')
            .addOrderBy('package.price', 'ASC')
            .limit(15);

        return queryBuilder;
    }

    // Step 5: Fallback search (broader search)
    private async fallbackSearch(
        packageRepo: Repository<Package>,
        requirements: any
    ): Promise<Package[]> {
        const queryBuilder = packageRepo
            .createQueryBuilder('package')
            .leftJoinAndSelect('package.company', 'company')
            .where('package.status = :status', { status: 'active' });

        // Broaden price range if max budget exists
        if (requirements.maxBudget) {
            queryBuilder.andWhere('package.price <= :maxPrice', {
                maxPrice: requirements.maxBudget * 1.5 // Allow 50% higher
            });
        }

        // Broaden event type search
        if (requirements.eventType && requirements.eventType !== 'general') {
            queryBuilder.andWhere('package.name ILIKE :eventType', {
                eventType: `%${requirements.eventType}%`
            });
        }

        // Remove feature restrictions for fallback (broader search)

        return queryBuilder
            .orderBy('package.price', 'ASC')
            .limit(10)
            .getMany();
    }

    // Step 6: Rank packages
    private async rankPackages(
        packages: Package[],
        originalQuery: string,
        requirements: any
    ): Promise<IPackageWithScore[]> {
        if (packages.length === 0) return [];

        try {
            const prompt = `
      Rank these photography packages based on user query.
      
      User Query: "${originalQuery}"
      User Requirements: ${JSON.stringify(requirements, null, 2)}
      
      Packages to rank:
      ${packages.map((pkg, i) => `
        ${i + 1}. ${pkg.name} ($${pkg.price})
        - Duration: ${pkg.duration}
        - Features: ${Array.isArray(pkg.features) ? pkg.features.join(', ') : 'N/A'}
        - Company: ${pkg.company?.name || 'Unknown'} (${pkg.company?.country || 'Unknown'})
        - Popular: ${pkg.isPopular ? 'Yes' : 'No'}
      `).join('\n')}
      
      For each package, provide:
      1. Relevance score (0-100)
      2. Explanation of why it matches
      3. List of specific match reasons (array of strings)
      
      Return as JSON array with this structure:
      [
        {
          "id": "package-id",
          "name": "package name",
          "price": 199,
          "duration": "4 hours",
          "features": ["feature1", "feature2"],
          "companyName": "Company Name",
          "companyCountry": "Country",
          "companyEmail": "email@example.com",
          "isPopular": true,
          "score": 85,
          "explanation": "Why this package matches...",
          "matchReasons": ["Reason 1", "Reason 2"]
        }
      ]
      
      Sort by score descending.
      `;

            const result = await this.ai.models.generateContent({
                model: "models/gemini-2.5-flash-lite",
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 2000,
                },
            });

            const jsonMatch = result.text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const ranked = JSON.parse(jsonMatch[0]);

                return ranked.map((rankedPkg: any) => {
                    const originalPkg = packages.find(p => p.id === rankedPkg.id) || packages[0];

                    // Check date availability
                    const dateAvailability = this.checkDateAvailability(
                        originalPkg.company?.lockedDates || [],
                        originalPkg.duration,
                        requirements.eventDate ? new Date(requirements.eventDate) : undefined,
                        requirements.dateRange ? {
                            startDate: new Date(requirements.dateRange.startDate),
                            endDate: new Date(requirements.dateRange.endDate)
                        } : undefined
                    );

                    return {
                        ...rankedPkg,
                        companyEmail: originalPkg.company?.email || '',
                        features: originalPkg.features || [],
                        dateAvailability: dateAvailability // NEW FIELD
                    };
                }).slice(0, 10);
            }

        } catch (error) {
            console.error("AI ranking failed:", error);
        }

        // Fallback ranking
        return this.fallbackRankPackages(packages, requirements);
    }

    private fallbackRankPackages(
        packages: Package[],
        requirements: any
    ): IPackageWithScore[] {
        return packages.map(pkg => {
            let score = 50; // Base score
            const matchReasons: string[] = [];

            // Price scoring
            if (requirements.maxBudget) {
                const priceRatio = pkg.price / requirements.maxBudget;
                if (priceRatio <= 1) {
                    score += 30;
                    matchReasons.push(`Within budget ($${pkg.price} ≤ $${requirements.maxBudget})`);
                } else if (priceRatio <= 1.2) {
                    score += 15;
                    matchReasons.push(`Slightly above budget ($${pkg.price})`);
                } else {
                    score -= 10;
                }
            }

            // Feature matching
            if (pkg.features && Array.isArray(pkg.features)) {
                const matchedFeatures = pkg.features.filter(feature =>
                    requirements.requiredFeatures.some((reqFeature: string) =>
                        feature.toLowerCase().includes(reqFeature.toLowerCase()) ||
                        reqFeature.toLowerCase().includes(feature.toLowerCase())
                    )
                );

                if (matchedFeatures.length > 0) {
                    score += matchedFeatures.length * 10;
                    matchReasons.push(`Includes required features: ${matchedFeatures.join(', ')}`);
                }
            }

            // Popularity bonus
            if (pkg.isPopular) {
                score += 10;
                matchReasons.push('Popular choice');
            }

            // Name matching
            if (requirements.eventType && pkg.name.toLowerCase().includes(requirements.eventType)) {
                score += 15;
                matchReasons.push(`Specialized for ${requirements.eventType}`);
            }

            // Cap score
            score = Math.min(Math.max(score, 0), 100);

            return {
                id: pkg.id,
                name: pkg.name,
                price: pkg.price,
                duration: pkg.duration,
                features: pkg.features || [],
                companyName: pkg.company?.name || 'Unknown',
                companyCountry: pkg.company?.country || '',
                companyEmail: pkg.company?.email || '',
                isPopular: pkg.isPopular,
                score: score,
                explanation: `Score: ${score}/100. ${matchReasons.join(' ')}`,
                matchReasons: matchReasons
            };
        }).sort((a, b) => b.score - a.score).slice(0, 10);
    }

    // Step 7: Generate natural language response
    private async generateResponse(
        packages: IPackageWithScore[],
        originalQuery: string
    ): Promise<string> {
        if (packages.length === 0) {
            return "I couldn't find any packages matching your specific requirements. Try adjusting your budget or features.";
        }

        try {
            // Create a more natural, less structured prompt
            const prompt = `
You are a helpful photography package recommendation assistant. A user asked: "${originalQuery}"

I've found ${packages.length} photography packages that match their needs. Here's what I found:

${packages.map((pkg, i) => `
Package ${i + 1}: ${pkg.name}
- Price: $${pkg.price}
- Duration: ${pkg.duration}
- Company: ${pkg.companyName} (${pkg.companyCountry})
- Key Features: ${pkg.features.slice(0, 5).join(', ')}
1-100 Match Score: ${pkg.score}
Why it matches: ${pkg.explanation}
`).join('\n\n')}

Based on these findings, please craft a helpful response to the user. In your response:
1. Start by acknowledging their request in a friendly way
2. Briefly mention how many packages you found
3. Highlight 2-3 of the best options, explaining why they're good matches
4. Mention any important trade-offs or considerations (like budget vs features)
5. End with a suggestion for next steps

Make it sound natural and conversational - like you're actually helping someone choose. Don't just list packages; analyze and recommend.

Focus on what matters most to the user based on their query: ${originalQuery}

Format the response in plain, readable English. No markdown, no bullet points in the response itself.
`;

            const result = await this.ai.models.generateContent({
                model: "models/gemini-2.5-flash-lite",
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.8, // Higher temperature for more creative, varied responses
                    maxOutputTokens: 1000,
                },
            });

            return result.text;

        } catch (error) {
            console.error("AI response generation failed:", error);

            // More detailed fallback
            return this.generateFallbackResponse(packages, originalQuery);
        }
    }
    private generateFallbackResponse(packages: IPackageWithScore[], originalQuery: string): string {
        const topPackages = packages.slice(0, 3);

        let response = `Hi! I found ${packages.length} photography packages that match your request for "${originalQuery}".\n\n`;

        // Analyze the query for key requirements
        const hasBudget = originalQuery.toLowerCase().includes('under') || originalQuery.includes('$');
        const hasFeatures = packages.some(p => p.features.length > 0);

        if (hasBudget) {
            response += "Here are the best options within your budget:\n\n";
        } else {
            response += "Here are some great options I found:\n\n";
        }

        // Describe top packages
        topPackages.forEach((pkg, i) => {
            response += `${i + 1}. **${pkg.name}** (${pkg.score}/100 match)\n`;
            response += `   Price: $${pkg.price} | Duration: ${pkg.duration}\n`;
            response += `   By: ${pkg.companyName}\n`;

            if (pkg.features.length > 0) {
                const keyFeatures = pkg.features.slice(0, 3);
                response += `   Includes: ${keyFeatures.join(', ')}\n`;
            }

            response += `   ${pkg.explanation}\n\n`;
        });

        // Add analysis
        if (packages.length > 1) {
            const priceRange = `$${Math.min(...packages.map(p => p.price))} - $${Math.max(...packages.map(p => p.price))}`;
            response += `\nPrices range from ${priceRange}. `;

            const avgScore = Math.round(packages.reduce((sum, p) => sum + p.score, 0) / packages.length);
            response += `The average match score is ${avgScore}/100.\n\n`;
        }

        response += "Would you like more details on any of these options, or should I search for something more specific?";

        return response;
    }

    // Additional endpoint: Quick package search
    public quickSearch = async (
        req: Request<{}, {}, { search: string; limit?: number }>,
        res: Response<ICreateEventResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();

        try {
            const { search, limit = 10 } = req.body;

            if (!search || search.trim() === "") {
                return res.status(400).json({
                    success: false,
                    message: "Search term is required"
                });
            }

            const packageRepo = queryRunner.manager.getRepository(Package);

            const packages = await packageRepo
                .createQueryBuilder('package')
                .leftJoinAndSelect('package.company', 'company')
                .where('package.status = :status', { status: 'active' })
                .andWhere('(package.name ILIKE :search OR package.features::text ILIKE :search)', {
                    search: `%${search}%`
                })
                .orderBy('package.isPopular', 'DESC')
                .addOrderBy('package.price', 'ASC')
                .limit(limit)
                .getMany();

            return res.status(200).json({
                success: true,
                message: "Search completed",
                data: {
                    searchTerm: search,
                    results: packages,
                    count: packages.length
                }
            });

        } catch (error: any) {
            console.error("Quick search error:", error);
            return res.status(500).json({
                success: false,
                message: error.message || "Search failed",
                error: "Internal server error"
            });
        } finally {
            await queryRunner.release();
        }
    };

    // Get package by ID with details
    public getPackageDetails = async (
        req: Request<{ id: string }, {}, {}>,
        res: Response<ICreateEventResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();

        try {
            const { id } = req.params;

            const packageRepo = queryRunner.manager.getRepository(Package);

            const pkg = await packageRepo
                .createQueryBuilder('package')
                .leftJoinAndSelect('package.company', 'company')
                .where('package.id = :id', { id })
                .andWhere('package.status = :status', { status: 'active' })
                .getOne();

            if (!pkg) {
                return res.status(404).json({
                    success: false,
                    message: "Package not found or inactive"
                });
            }

            return res.status(200).json({
                success: true,
                data: pkg
            });

        } catch (error: any) {
            console.error("Get package error:", error);
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to get package details",
                error: "Internal server error"
            });
        } finally {
            await queryRunner.release();
        }
    };

    public listModels = async (req: Request, res: Response) => {
        try {
            const models = await this.ai.models.list();

            return res.status(200).json({
                success: true,
                data: models
            });
        } catch (error: any) {
            console.error("Error listing models:", error);
            return res.status(500).json({
                success: false,
                error: "Failed to list models"
            });
        }
    };

    private checkDateAvailability(
        lockedDates: string[], // Changed from Date[] to string[]
        packageDuration: string,
        eventDate?: Date,
        dateRange?: { startDate: Date, endDate: Date }
    ): {
        isAvailable: boolean;
        message: string;
        conflictingDates?: Date[];
        isDateRangeAvailable?: boolean;
    } {
        if (!eventDate && !dateRange) {
            return {
                isAvailable: true,
                message: "No date specified - contact company for availability"
            };
        }

        // Parse duration string to days
        const durationInDays = this.parseDurationToDays(packageDuration);

        // Convert string dates to Date objects for comparison
        const lockedDateObjects = lockedDates?.map(dateStr => new Date(dateStr)) || [];

        if (eventDate) {
            // Check single date
            const isDateLocked = lockedDateObjects.some(lockedDate =>
                this.isSameDay(lockedDate, eventDate)
            );

            if (isDateLocked) {
                return {
                    isAvailable: false,
                    message: "This specific date is already booked",
                    conflictingDates: [eventDate]
                };
            }

            // Check date range if duration > 1 day
            if (durationInDays > 1) {
                const endDate = new Date(eventDate);
                endDate.setDate(endDate.getDate() + durationInDays - 1);

                const conflictingDates = this.checkDateRangeAvailability(
                    lockedDateObjects,
                    eventDate,
                    endDate
                );

                if (conflictingDates.length > 0) {
                    return {
                        isAvailable: false,
                        message: `Date range conflicts with ${conflictingDates.length} booked date(s)`,
                        conflictingDates: conflictingDates,
                        isDateRangeAvailable: false
                    };
                }
            }

            return {
                isAvailable: true,
                message: "Date appears available (confirm with company)",
                isDateRangeAvailable: true
            };
        }

        if (dateRange) {
            // Check date range
            const conflictingDates = this.checkDateRangeAvailability(
                lockedDateObjects,
                dateRange.startDate,
                dateRange.endDate
            );

            if (conflictingDates.length > 0) {
                return {
                    isAvailable: false,
                    message: `Date range conflicts with ${conflictingDates.length} booked date(s)`,
                    conflictingDates: conflictingDates,
                    isDateRangeAvailable: false
                };
            }

            return {
                isAvailable: true,
                message: "Date range appears available (confirm with company)",
                isDateRangeAvailable: true
            };
        }

        return {
            isAvailable: true,
            message: "Contact company for date availability"
        };
    }

    private parseDurationToDays(duration: string): number {
        // Parse "4 hours", "2 days", "1 week" to days
        if (!duration) return 1;

        const lower = duration.toLowerCase();
        if (lower.includes('hour')) return 1;
        if (lower.includes('day')) {
            const match = duration.match(/(\d+)\s*days?/i);
            return match ? parseInt(match[1]) : 1;
        }
        if (lower.includes('week')) {
            const match = duration.match(/(\d+)\s*weeks?/i);
            return match ? parseInt(match[1]) * 7 : 7;
        }
        if (lower.includes('month')) {
            const match = duration.match(/(\d+)\s*months?/i);
            return match ? parseInt(match[1]) * 30 : 30;
        }
        return 1;
    }

    private isSameDay(date1: Date, date2: Date): boolean {
        return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
    }

    private checkDateRangeAvailability(
        lockedDates: Date[],
        startDate: Date,
        endDate: Date
    ): Date[] {
        const conflictingDates: Date[] = [];

        for (const lockedDate of lockedDates) {
            if (lockedDate >= startDate && lockedDate <= endDate) {
                conflictingDates.push(lockedDate);
            }
        }

        return conflictingDates;
    }

    // Helper method to parse date strings from query
    private extractDatesFromQuery(query: string): {
        eventDate?: Date;
        dateRange?: { startDate: Date; endDate: Date };
    } {
        const result: any = {};
        const lowerQuery = query.toLowerCase();

        // Try to parse ISO dates (YYYY-MM-DD)
        const isoDateRegex = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
        const isoMatches = [...query.matchAll(isoDateRegex)];

        // Try to parse common date formats
        const commonDateRegex = /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b|\b(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})\b/g;
        const commonMatches = [...query.matchAll(commonDateRegex)];

        // Try to parse month names
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december',
            'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

        const monthRegex = new RegExp(`\\b(${monthNames.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})\\b`, 'gi');
        const monthMatches = [...query.matchAll(monthRegex)];

        const allMatches = [...isoMatches, ...commonMatches, ...monthMatches];

        if (allMatches.length === 1) {
            try {
                const dateStr = this.normalizeDateString(allMatches[0][0]);
                result.eventDate = new Date(dateStr);
            } catch (e) {
                console.error("Failed to parse date:", e);
            }
        } else if (allMatches.length >= 2) {
            try {
                const date1Str = this.normalizeDateString(allMatches[0][0]);
                const date2Str = this.normalizeDateString(allMatches[1][0]);

                const startDate = new Date(date1Str);
                const endDate = new Date(date2Str);

                // Ensure start date is before end date
                if (startDate <= endDate) {
                    result.dateRange = { startDate, endDate };
                } else {
                    result.dateRange = { startDate: endDate, endDate: startDate };
                }
            } catch (e) {
                console.error("Failed to parse date range:", e);
            }
        }

        // Check for "from X to Y" pattern
        const fromToRegex = /from\s+([^,\\.]+?)\s+to\s+([^,\\.]+)/gi;
        const fromToMatch = fromToRegex.exec(query);
        if (fromToMatch) {
            // Parse the dates from the from-to pattern
            // You might need more sophisticated parsing here
        }

        return result;
    }

    private normalizeDateString(dateStr: string): string {
        // Convert various date formats to ISO-like format
        dateStr = dateStr.trim().toLowerCase();

        // Handle month names
        const monthMap: { [key: string]: string } = {
            'january': '01', 'february': '02', 'march': '03', 'april': '04',
            'may': '05', 'june': '06', 'july': '07', 'august': '08',
            'september': '09', 'october': '10', 'november': '11', 'december': '12',
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'jun': '06',
            'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
        };

        // Check for month name format
        for (const monthName in monthMap) {
            if (dateStr.includes(monthName)) {
                // Extract day and year
                const parts = dateStr.split(/\s+/);
                const day = parts.find(p => /\d+/.test(p))?.replace(/\D/g, '') || '01';
                const year = parts.find(p => /\d{4}/.test(p)) || new Date().getFullYear().toString();

                return `${year}-${monthMap[monthName]}-${day.padStart(2, '0')}`;
            }
        }

        // Handle numeric formats
        if (dateStr.match(/\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/)) {
            // Already in ISO-like format
            return dateStr.replace(/[\/\-\.]/g, '-');
        }

        if (dateStr.match(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}/)) {
            // DD/MM/YYYY or MM/DD/YYYY format - assume DD/MM/YYYY
            const parts = dateStr.split(/[\/\-\.]/);
            if (parts[2].length === 4) {
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }

        return dateStr;
    }
}

export default new GeminiController();