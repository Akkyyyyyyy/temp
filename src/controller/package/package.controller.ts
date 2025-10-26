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
        memberId 
      } = req.body;

      // Validate required fields
      if (!name || !price || !duration || !status || !memberId) {
        res.status(400).json({ message: "All required fields must be provided" });
        return;
      }

      const packageRepo = AppDataSource.getRepository(Package);
      const memberRepo = AppDataSource.getRepository(Member);

      // Check if member exists
      const member = await memberRepo.findOne({ where: { id: memberId } });
      if (!member) {
        res.status(404).json({ message: "Member not found" });
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
        member
      });

      await packageRepo.save(newPackage);

      // Fetch the created package with member relation
      const createdPackage = await packageRepo.findOne({
        where: { id: newPackage.id },
        relations: ["member"]
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
        relations: ["member"],
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
        relations: ["member"]
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
        relations: ["member"]
      });

      if (!packageItem) {
        res.status(404).json({ message: "Package not found" });
        return;
      }

      // Update package fields
      Object.assign(packageItem, updateData);
      await packageRepo.save(packageItem);

      // Fetch updated package
      const updatedPackage = await packageRepo.findOne({
        where: { id },
        relations: ["member"]
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
        relations: ["member"]
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

  // Get packages by member ID
  public getPackagesByMember = async (
    req: Request<{ memberId: string }>,
    res: Response<IPackageListResponse>
  ) => {
    try {
      const { memberId } = req.params;

      const packageRepo = AppDataSource.getRepository(Package);
      const packages = await packageRepo.find({
        where: { member: { id: memberId } },
        relations: ["member"],
        order: { createdAt: "DESC" }
      });

      return res.status(200).json({
        message: "Packages retrieved successfully",
        packages
      });
    } catch (error) {
      console.error("Error fetching packages by member:", error);
      res.status(500).json({ message: "An error occurred while fetching packages", packages: [] });
    }
  };
}

export default new PackageController();