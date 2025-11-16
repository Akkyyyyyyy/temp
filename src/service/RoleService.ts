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

interface RoleWithCounts {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number; // Number of active members with this role in the company
  assignmentCount: number; // Number of assignments with this role in the company
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
    const roleRepo = this.roleRepository;

    const rolesWithCounts = await roleRepo
      .createQueryBuilder('role')
      .leftJoin('role.companyMembers', 'companyMembers',
        'companyMembers.companyId = :companyId AND companyMembers.active = :active',
        { companyId, active: true }
      )
      .leftJoin('role.assignments', 'assignments')
      .leftJoin('assignments.project', 'project', 'project.companyId = :companyId', { companyId })
      .where('role.companyId = :companyId', { companyId })
      .select([
        'role.id',
        'role.name',
        'role.description',
        'role.createdAt',
        'role.updatedAt',
        'COUNT(DISTINCT companyMembers.id) as memberCount',
        'COUNT(DISTINCT assignments.id) as assignmentCount'
      ])
      .groupBy('role.id')
      .orderBy('role.name', 'ASC')
      .getRawMany();

    // Transform raw results to RoleWithCounts format
    return rolesWithCounts.map(role => ({
      id: role.role_id,
      name: role.role_name,
      description: role.role_description,
      createdAt: role.role_createdAt,
      updatedAt: role.role_updatedAt,
      memberCount: parseInt(role.memberCount) || 0,
      assignmentCount: parseInt(role.assignmentCount) || 0
    }));
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
  // async deleteForCompany(id: string, companyId: string): Promise<void> {
  //   const role = await this.roleRepository.findOne({
  //     where: { id, company: { id: companyId } }
  //   });

  //   if (!role) {
  //     throw new Error("Role not found in this company");
  //   }

  //   // Get detailed assignment information for better error messages
  //   const [companyMembers, assignments] = await Promise.all([
  //     // Get members with this role
  //     this.companyMemberRepository.find({
  //       where: {
  //         role: { id },
  //         company: { id: companyId }
  //       },
  //       relations: ['member'],
  //       take: 5 // Limit to first 5 for error message
  //     }),
  //     // Get assignments with this role
  //     this.assignmentRepository.find({
  //       where: {
  //         role: { id },
  //         project: { company: { id: companyId } }
  //       },
  //       relations: ['member', 'project'],
  //       take: 5 // Limit to first 5 for error message
  //     })
  //   ]);

  //   if (companyMembers.length > 0 || assignments.length > 0) {
  //     const memberNames = companyMembers.map(cm => cm.member.name).join(', ');
  //     const projectNames = assignments.map(a => a.project.name).join(', ');

  //     let errorMessage = `Cannot delete role "${role.name}" because it is currently assigned to:`;

  //     if (companyMembers.length > 0) {
  //       errorMessage += `\n- ${companyMembers.length} member(s): ${memberNames}`;
  //       if (companyMembers.length === 5) {
  //         errorMessage += '...';
  //       }
  //     }

  //     if (assignments.length > 0) {
  //       errorMessage += `\n- ${assignments.length} project assignment(s): ${projectNames}`;
  //       if (assignments.length === 5) {
  //         errorMessage += '...';
  //       }
  //     }

  //     errorMessage += '\n\nPlease reassign or remove these assignments before deleting the role.';

  //     throw new Error(errorMessage);
  //   }

  //   await this.roleRepository.remove(role);
  // }

  // Delete role (for backward compatibility - deprecated)
  async delete(id: string): Promise<void> {
    // This method is now problematic without company context
    throw new Error("Use deleteForCompany method with company context");
  }

  // Get role usage count within a specific company
  // async getRoleUsageCountForCompany(id: string, companyId: string): Promise<{ memberCount: number; assignmentCount: number }> {
  //   const [memberCount, assignmentCount] = await Promise.all([
  //     this.memberRepository.count({
  //       where: {
  //         role: { id },
  //         company: { id: companyId }
  //       }
  //     }),
  //     this.assignmentRepository.count({
  //       where: {
  //         role: { id },
  //         project: { company: { id: companyId } }
  //       }
  //     })
  //   ]);

  //   return { memberCount, assignmentCount };
  // }

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