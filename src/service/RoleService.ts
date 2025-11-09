import { Repository, DataSource } from "typeorm";
import { Role } from "../entity/Role";
import { Member } from "../entity/Member";
import { ProjectAssignment } from "../entity/ProjectAssignment";

export interface CreateRoleRequest {
  name: string;
  description?: string;
  companyId: string;
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
}

export interface RoleWithCounts extends Role {
  memberCount: number;
  assignmentCount: number;
}

export class RoleService {
  private roleRepository: Repository<Role>;
  private memberRepository: Repository<Member>;
  private assignmentRepository: Repository<ProjectAssignment>;

  constructor(private dataSource: DataSource) {
    this.roleRepository = dataSource.getRepository(Role);
    this.memberRepository = dataSource.getRepository(Member);
    this.assignmentRepository = dataSource.getRepository(ProjectAssignment);
  }

  // Find all roles for a specific company
  async findByCompanyId(companyId: string): Promise<RoleWithCounts[]> {
    const roles = await this.roleRepository.find({
      where: { companyId },
      order: { name: "ASC" }
    });

    // Get counts for each role within the company
    const rolesWithCounts = await Promise.all(
      roles.map(async (role) => {
        const [memberCount, assignmentCount] = await Promise.all([
          this.memberRepository.count({ 
            where: { 
              role: { id: role.id },
              company: { id: companyId }
            } 
          }),
          this.assignmentRepository.count({ 
            where: { 
              role: { id: role.id },
              project: { company: { id: companyId } }
            } 
          })
        ]);

        return {
          ...role,
          memberCount,
          assignmentCount
        };
      })
    );

    return rolesWithCounts;
  }

  // Find role by ID within a specific company
  async findByIdAndCompany(id: string, companyId: string): Promise<Role | null> {
    return await this.roleRepository.findOne({ 
      where: { id, companyId } 
    });
  }

  // Find role by ID (for backward compatibility)
  async findById(id: string): Promise<Role | null> {
    return await this.roleRepository.findOne({ where: { id } });
  }

  // Create role for a specific company
  async createForCompany(roleData: CreateRoleRequest): Promise<Role> {
    // Check if role name already exists in the same company
    const existingRole = await this.roleRepository.findOne({
      where: { 
        name: roleData.name,
        companyId: roleData.companyId
      }
    });

    if (existingRole) {
      throw new Error("Role name already exists in this company");
    }

    const role = this.roleRepository.create(roleData);
    return await this.roleRepository.save(role);
  }

  // Create role (for backward compatibility - deprecated)
  async create(roleData: CreateRoleRequest): Promise<Role> {
    return this.createForCompany(roleData);
  }

  // Update role within a specific company
  async updateForCompany(id: string, companyId: string, roleData: UpdateRoleRequest): Promise<Role> {
    const role = await this.roleRepository.findOne({ 
      where: { id, companyId } 
    });
    
    if (!role) {
      throw new Error("Role not found");
    }

    // Check if new name conflicts with existing role in the same company
    if (roleData.name && roleData.name !== role.name) {
      const existingRole = await this.roleRepository.findOne({
        where: { 
          name: roleData.name,
          companyId: companyId
        }
      });

      if (existingRole && existingRole.id !== id) {
        throw new Error("Role name already exists in this company");
      }
    }

    Object.assign(role, roleData);
    return await this.roleRepository.save(role);
  }

  // Update role (for backward compatibility - deprecated)
  async update(id: string, roleData: UpdateRoleRequest): Promise<Role> {
    // This method is now problematic without company context
    throw new Error("Use updateForCompany method with company context");
  }

  // Delete role within a specific company
  async deleteForCompany(id: string, companyId: string): Promise<void> {
    const role = await this.roleRepository.findOne({ 
      where: { id, companyId } 
    });
    
    if (!role) {
      throw new Error("Role not found");
    }

    // Check if role is assigned to any members or assignments within the company
    const [memberCount, assignmentCount] = await Promise.all([
      this.memberRepository.count({ 
        where: { 
          role: { id },
          company: { id: companyId }
        } 
      }),
      this.assignmentRepository.count({ 
        where: { 
          role: { id },
          project: { company: { id: companyId } }
        } 
      })
    ]);

    const totalAssignments = memberCount + assignmentCount;
    
    if (totalAssignments > 0) {
      throw new Error(`Role is assigned to ${totalAssignments} users and cannot be deleted`);
    }

    await this.roleRepository.remove(role);
  }

  // Delete role (for backward compatibility - deprecated)
  async delete(id: string): Promise<void> {
    // This method is now problematic without company context
    throw new Error("Use deleteForCompany method with company context");
  }

  // Get role usage count within a specific company
  async getRoleUsageCountForCompany(id: string, companyId: string): Promise<{ memberCount: number; assignmentCount: number }> {
    const [memberCount, assignmentCount] = await Promise.all([
      this.memberRepository.count({ 
        where: { 
          role: { id },
          company: { id: companyId }
        } 
      }),
      this.assignmentRepository.count({ 
        where: { 
          role: { id },
          project: { company: { id: companyId } }
        } 
      })
    ]);

    return { memberCount, assignmentCount };
  }

  // Get role usage count (for backward compatibility - deprecated)
  async getRoleUsageCount(id: string): Promise<{ memberCount: number; assignmentCount: number }> {
    // This method is now problematic without company context
    throw new Error("Use getRoleUsageCountForCompany method with company context");
  }

  // Additional utility methods

  // Check if role exists in company
  async existsInCompany(id: string, companyId: string): Promise<boolean> {
    const count = await this.roleRepository.count({
      where: { id, companyId }
    });
    return count > 0;
  }

  // Get default roles for a company (useful for company setup)
  async createDefaultRoles(companyId: string): Promise<Role[]> {
    const defaultRoles = [
      { name: "Admin", description: "Administrator with full access" },
      { name: "Manager", description: "Project manager" },
      { name: "Developer", description: "Software developer" },
      { name: "Designer", description: "UI/UX designer" },
      { name: "Viewer", description: "Read-only access" }
    ];

    const roles: Role[] = [];

    for (const roleData of defaultRoles) {
      try {
        const role = await this.createForCompany({
          ...roleData,
          companyId
        });
        roles.push(role);
      } catch (error) {
        // Ignore duplicate role errors during default creation
        if (!(error instanceof Error && error.message.includes("already exists"))) {
          throw error;
        }
      }
    }

    return roles;
  }

  // Find role by name within a company
  async findByNameAndCompany(name: string, companyId: string): Promise<Role | null> {
    return await this.roleRepository.findOne({
      where: { name, companyId }
    });
  }
}