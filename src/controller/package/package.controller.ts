import { Request, Response } from "express";
import {
  ICreatePackageRequest,
  IUpdatePackageRequest,
  IPackageResponse,
  IPackageListResponse
} from "./type";
import { AppDataSource } from "../../config/data-source";
import { Package } from "../../entity/Package";
import { Member } from "../../entity/Member";
import { Company } from "../../entity/Company";

class PackageController {
  // Create a new package
  public createPackage = async (
    req: Request<{}, {}, ICreatePackageRequest>,
    res: Response<IPackageResponse>
  ) => {
    try {
      const {
        name,
        price,
        duration,
        isPopular,
        features,
        addons,
        status,
        companyId
      } = req.body;

      // Validate required fields
      if (!name || !price || !duration || !status || !companyId) {
        res.status(400).json({ message: "All required fields must be provided" });
        return;
      }

      const packageRepo = AppDataSource.getRepository(Package);
      const companyRepo = AppDataSource.getRepository(Company);

      // Check if member exists
      const company = await companyRepo.findOne({ where: { id: companyId } });
      if (!company) {
        res.status(404).json({ message: "Member not found" });
        return;
      }

      // Validate features is an array if provided
      if (features && !Array.isArray(features)) {
        res.status(400).json({ message: "Features must be an array" });
        return;
      }

      // Create new package
      const newPackage = packageRepo.create({
        name,
        price,
        duration,
        isPopular: isPopular || false,
        features: features || null,
        addons: addons || null,
        status,
        company
      });

      await packageRepo.save(newPackage);

      // Fetch the created package with member relation
      const createdPackage = await packageRepo.findOne({
        where: { id: newPackage.id },
        relations: ["company"]
      });

      return res.status(201).json({ 
        message: "Package created successfully",
        package: createdPackage
      });
    } catch (error) {
      console.error("Error creating package:", error);
      res.status(500).json({ message: "An error occurred while creating package" });
    }
  };

  // Get all packages
  public getAllPackages = async (
    req: Request,
    res: Response<IPackageListResponse>
  ) => {
    try {
      const packageRepo = AppDataSource.getRepository(Package);

      const packages = await packageRepo.find({
        relations: ["company"],
        order: { createdAt: "DESC" }
      });

      return res.status(200).json({
        message: "Packages retrieved successfully",
        packages
      });
    } catch (error) {
      console.error("Error fetching packages:", error);
      res.status(500).json({ message: "An error occurred while fetching packages", packages: [] });
    }
  };

  // Get package by ID
  public getPackageById = async (
    req: Request<{ id: string }>,
    res: Response<IPackageResponse>
  ) => {
    try {
      const { id } = req.params;

      const packageRepo = AppDataSource.getRepository(Package);
      const packageItem = await packageRepo.findOne({
        where: { id },
        relations: ["company"]
      });

      if (!packageItem) {
        res.status(404).json({ message: "Package not found" });
        return;
      }

      return res.status(200).json({
        message: "Package retrieved successfully",
        package: packageItem
      });
    } catch (error) {
      console.error("Error fetching package:", error);
      res.status(500).json({ message: "An error occurred while fetching package" });
    }
  };

  // Update package
  public updatePackage = async (
    req: Request<{ id: string }, {}, IUpdatePackageRequest>,
    res: Response<IPackageResponse>
  ) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const packageRepo = AppDataSource.getRepository(Package);
      
      const packageItem = await packageRepo.findOne({
        where: { id },
        relations: ["company"]
      });

      if (!packageItem) {
        res.status(404).json({ message: "Package not found" });
        return;
      }

      // Validate features is an array if provided
      if (updateData.features && !Array.isArray(updateData.features)) {
        res.status(400).json({ message: "Features must be an array" });
        return;
      }

      // Update package fields
      Object.assign(packageItem, updateData);
      await packageRepo.save(packageItem);

      // Fetch updated package
      const updatedPackage = await packageRepo.findOne({
        where: { id },
        relations: ["company"]
      });

      return res.status(200).json({
        message: "Package updated successfully",
        package: updatedPackage
      });
    } catch (error) {
      console.error("Error updating package:", error);
      res.status(500).json({ message: "An error occurred while updating package" });
    }
  };

  // Delete package
  public deletePackage = async (
    req: Request<{ id: string }>,
    res: Response<IPackageResponse>
  ) => {
    try {
      const { id } = req.params;

      const packageRepo = AppDataSource.getRepository(Package);
      const packageItem = await packageRepo.findOne({
        where: { id },
        relations: ["company"]
      });

      if (!packageItem) {
        res.status(404).json({ message: "Package not found" });
        return;
      }

      await packageRepo.remove(packageItem);

      return res.status(200).json({
        message: "Package deleted successfully",
        package: packageItem
      });
    } catch (error) {
      console.error("Error deleting package:", error);
      res.status(500).json({ message: "An error occurred while deleting package" });
    }
  };

  public getPackagesByCompany = async (
    req: Request<{ companyId: string }>,
    res: Response<IPackageListResponse>
  ) => {
    try {
      const { companyId } = req.params;

      const packageRepo = AppDataSource.getRepository(Package);
      const companyRepo = AppDataSource.getRepository(Company);

      // Get packages for the specific company
      const packages = await packageRepo.find({
        where: { company: { id: companyId } },
        relations: ["company"],
        order: { createdAt: "DESC" }
      });

      // Get the company's price separately to ensure we have it even if no packages exist
      const company = await companyRepo.findOne({
        where: { id: companyId },
        select: ["price"]
      });

      const companyPrice = company?.price || null;

      return res.status(200).json({
        message: "Packages retrieved successfully",
        packages,
        companyPrice // Add company price to response
      });
    } catch (error) {
      console.error("Error fetching packages by company:", error);
      res.status(500).json({
        message: "An error occurred while fetching packages",
        packages: [],
        companyPrice: null
      });
    }
  };
  // Set/Add company price
  public setCompanyPrice = async (
    req: Request<{ companyId: string }>,
    res: Response<{ message: string; company?: Company }>
  ) => {
    try {
      const { companyId } = req.params;
      const { price } = req.body;

      // Validate price
      if (price === undefined || price === null) {
        return res.status(400).json({ message: "Price is required" });
      }

      if (typeof price !== "number" || price < 0) {
        return res.status(400).json({ message: "Price must be a positive number" });
      }

      const companyRepo = AppDataSource.getRepository(Company);

      // Find the company
      const company = await companyRepo.findOne({
        where: { id: companyId }
      });

      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Update the company price
      company.price = price;
      await companyRepo.save(company);

      return res.status(200).json({
        message: "Company price set successfully",
        company
      });
    } catch (error) {
      console.error("Error setting company price:", error);
      res.status(500).json({ message: "An error occurred while setting company price" });
    }
  };
  // Update company price
  public updateCompanyPrice = async (
    req: Request<{ companyId: string }>,
    res: Response<{ message: string; company?: Company }>
  ) => {
    try {
      const { companyId } = req.params;
      const { price } = req.body;

      // Validate price
      if (price === undefined || price === null) {
        return res.status(400).json({ message: "Price is required" });
      }

      if (typeof price !== "number" || price < 0) {
        return res.status(400).json({ message: "Price must be a positive number" });
      }

      const companyRepo = AppDataSource.getRepository(Company);

      // Find the company
      const company = await companyRepo.findOne({
        where: { id: companyId }
      });

      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Update the company price
      company.price = price;
      const updatedCompany = await companyRepo.save(company);

      return res.status(200).json({
        message: "Company price updated successfully",
        company: updatedCompany
      });
    } catch (error) {
      console.error("Error updating company price:", error);
      res.status(500).json({ message: "An error occurred while updating company price" });
    }
  };
  // Remove/Reset company price
  public removeCompanyPrice = async (
    req: Request<{ companyId: string }>,
    res: Response<{ message: string; company?: Company }>
  ) => {
    try {
      const { companyId } = req.params;

      const companyRepo = AppDataSource.getRepository(Company);

      // Find the company
      const company = await companyRepo.findOne({
        where: { id: companyId }
      });

      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Set price to null
      company.price = null;
      const updatedCompany = await companyRepo.save(company);

      return res.status(200).json({
        message: "Company price removed successfully",
        company: updatedCompany
      });
    } catch (error) {
      console.error("Error removing company price:", error);
      res.status(500).json({ message: "An error occurred while removing company price" });
    }
  };
}

export default new PackageController();