import { Request, Response } from "express";
import { CreateRoleRequest, RoleService, UpdateRoleRequest } from "../../service/RoleService";
import { AppDataSource } from "../../config/data-source";

class RoleController {
  private roleService: RoleService;

  constructor() {
    this.roleService = new RoleService(AppDataSource);
  }

  // Get all roles for a company
  public getCompanyRoles = async (req: Request, res: Response) => {
    try {
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          error: "Company ID is required",
          code: "MISSING_COMPANY_ID"
        });
      }

      const roles = await this.roleService.findByCompanyId(companyId);
      res.status(200).json(roles);
    } catch (error) {
      console.error("Error fetching company roles:", error);
      res.status(500).json({
        error: "Failed to fetch roles",
        code: "FETCH_ROLES_ERROR"
      });
    }
  };

  // Get specific role within company
  public getRoleById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          error: "Company ID is required",
          code: "MISSING_COMPANY_ID"
        });
      }

      const role = await this.roleService.findByIdAndCompany(id, companyId);

      if (!role) {
        return res.status(404).json({
          error: "Role not found",
          code: "ROLE_NOT_FOUND"
        });
      }

      res.status(200).json(role);
    } catch (error) {
      console.error("Error fetching role:", error);
      res.status(500).json({
        error: "Failed to fetch role",
        code: "FETCH_ROLE_ERROR"
      });
    }
  };

  // Create role for a company
  public createRole = async (req: Request, res: Response) => {
    try {
      const { name, description, companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          error: "Company ID is required",
          code: "MISSING_COMPANY_ID"
        });
      }

      if (!name || name.trim() === "") {
        return res.status(400).json({
          error: "Role name is required",
          code: "MISSING_ROLE_NAME"
        });
      }

      const roleData: CreateRoleRequest = {
        name: name.trim(),
        description: description?.trim(),
        companyId
      };

      const role = await this.roleService.createForCompany(roleData);
      res.status(201).json(role);
    } catch (error) {
      console.error("Error creating role:", error);

      if (error instanceof Error && error.message === "Role name already exists in this company") {
        return res.status(409).json({
          error: "Role name already exists in this company",
          code: "ROLE_NAME_EXISTS"
        });
      }

      res.status(500).json({
        error: "Failed to create role",
        code: "CREATE_ROLE_ERROR"
      });
    }
  };

  // Update role within company
  public updateRole = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, description, companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          error: "Company ID is required",
          code: "MISSING_COMPANY_ID"
        });
      }

      if (name !== undefined && name.trim() === "") {
        return res.status(400).json({
          error: "Role name cannot be empty",
          code: "EMPTY_ROLE_NAME"
        });
      }

      const updateData: UpdateRoleRequest = {};
      if (name !== undefined) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description.trim();

      const role = await this.roleService.updateForCompany(id, companyId, updateData);
      res.status(200).json(role);
    } catch (error) {
      console.error("Error updating role:", error);

      if (error instanceof Error) {
        if (error.message === "Role not found") {
          return res.status(404).json({
            error: "Role not found",
            code: "ROLE_NOT_FOUND"
          });
        }

        if (error.message === "Role name already exists in this company") {
          return res.status(409).json({
            error: "Role name already exists in this company",
            code: "ROLE_NAME_EXISTS"
          });
        }
      }

      res.status(500).json({
        error: "Failed to update role",
        code: "UPDATE_ROLE_ERROR"
      });
    }
  };

  // Delete role within company
  public deleteRole = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          error: "Company ID is required",
          code: "MISSING_COMPANY_ID"
        });
      }

      await this.roleService.deleteForCompany(id, companyId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting role:", error);

      if (error instanceof Error) {
        if (error.message === "Role not found") {
          return res.status(404).json({
            error: "Role not found",
            code: "ROLE_NOT_FOUND"
          });
        }

        if (error.message.includes("assigned to") && error.message.includes("cannot be deleted")) {
          return res.status(409).json({
            error: error.message,
            code: "ROLE_IN_USE"
          });
        }
      }

      res.status(500).json({
        error: "Failed to delete role",
        code: "DELETE_ROLE_ERROR"
      });
    }
  };

  // Get role usage within company
  public getRoleUsage = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          error: "Company ID is required",
          code: "MISSING_COMPANY_ID"
        });
      }

      const usage = await this.roleService.getRoleUsageCountForCompany(id, companyId);
      res.status(200).json(usage);
    } catch (error) {
      console.error("Error fetching role usage:", error);
      res.status(500).json({
        error: "Failed to fetch role usage",
        code: "FETCH_USAGE_ERROR"
      });
    }
  };

  // Create default roles for a company
  public createDefaultRoles = async (req: Request, res: Response) => {
    try {
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          error: "Company ID is required",
          code: "MISSING_COMPANY_ID"
        });
      }

      const roles = await this.roleService.createDefaultRoles(companyId);
      res.status(201).json({
        message: "Default roles created successfully",
        roles
      });
    } catch (error) {
      console.error("Error creating default roles:", error);
      res.status(500).json({
        error: "Failed to create default roles",
        code: "CREATE_DEFAULT_ROLES_ERROR"
      });
    }
  };
}


export default new RoleController();