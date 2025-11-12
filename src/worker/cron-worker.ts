import cron from 'node-cron';
import { sendProjectReminderEmail } from '../utils/mailer';
import { AppDataSource } from '../config/data-source';
import { Project } from '../entity/Project';

export class CronWorker {
    start() {
        cron.schedule(
            '00 08 * * *', this.sendProjectReminders.bind(this),
            {
                timezone: 'Europe/London'
            });
        console.log('Cron jobs initiallize successfully');
    }

    private async sendProjectReminders() {
        const startTime = new Date();
        console.log(`\nCron Jobs started!`);

        try {
            const projectRepo = AppDataSource.getRepository(Project);
            const today = new Date();

            // Simple and reliable date normalization
            const todayStr = today.toISOString().split('T')[0];

            // Calculate dates for reminders
            const oneWeekFromNow = new Date(today);
            oneWeekFromNow.setDate(today.getDate() + 7);
            const oneWeekFromNowStr = oneWeekFromNow.toISOString().split('T')[0];

            const oneDayFromNow = new Date(today);
            oneDayFromNow.setDate(today.getDate() + 1);
            const oneDayFromNowStr = oneDayFromNow.toISOString().split('T')[0];

            // Use QueryBuilder for reliable date comparison
            const upcomingProjects = await projectRepo
                .createQueryBuilder('project')
                .leftJoinAndSelect('project.assignments', 'assignments')
                .leftJoinAndSelect('assignments.member', 'member')
                .leftJoinAndSelect('project.company', 'company')
                .where('project.startDate IN (:...dates)', { dates: [oneWeekFromNowStr, oneDayFromNowStr] })
                .andWhere('project.reminders IS NOT NULL')
                .getMany();

            let totalEmailsSent = 0;
            let projectsWithReminders = 0;

            for (const project of upcomingProjects) {

                const daysUntilStart = this.getDaysDifference(todayStr, project.startDate);

                // Only process projects that are exactly 7 or 1 days away
                if (daysUntilStart !== 7 && daysUntilStart !== 1) {
                    continue;
                }

                const reminderType = daysUntilStart === 7 ? 'weekBefore' : 'dayBefore';

                // Check if this specific reminder is enabled
                if (project.reminders && project.reminders[reminderType]) {
                    const assignmentsCount = project.assignments?.length || 0;

                    let projectEmailsSent = 0;
                    const formattedStartDate = this.formatDateCustom(project.startDate);

                    for (const assignment of project.assignments) {
                        if (assignment.member) {
                            try {
                                await sendProjectReminderEmail(
                                    assignment.member.email,
                                    assignment.member.name,
                                    project.name,
                                    project.description || 'No description provided',
                                    formattedStartDate,
                                    project.startHour,
                                    project.endHour,
                                    project.location,
                                    project.company.name,
                                    reminderType,
                                    daysUntilStart
                                );
                                projectEmailsSent++;
                                totalEmailsSent++;

                            } catch (emailError) {
                                console.error(`     ❌ Failed to send email to ${assignment.member.email}:`, emailError);
                            }
                        }
                    }
                    projectsWithReminders++;

                } else {
                    console.log(`   ⚠️  ${reminderType} reminder is DISABLED for this project, skipping...`);
                }
            }

            const endTime = new Date();
            const executionTime = endTime.getTime() - startTime.getTime();

        } catch (error) {
            console.log(error);
        }
    }

    private getDaysDifference(date1: string, date2: string): number {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        const diffTime = Math.abs(d2.getTime() - d1.getTime());
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return days;
    }
    private formatDateCustom(dateInput: string | Date | undefined): string {
        if (!dateInput) return '';
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);

        const dd = String(d.getDate()).padStart(2, '0');
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const mmm = months[d.getMonth()];
        const yyyy = d.getFullYear();
        return `${dd} ${mmm} ${yyyy}`; // e.g. "20 Nov 2025"
    }
}

// Start the cron worker
export const cronWorker = new CronWorker();