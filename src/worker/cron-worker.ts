import cron from 'node-cron';
import { sendEventReminderEmail } from '../utils/mailer'; // You'll need to update this function name
import { AppDataSource } from '../config/data-source';
import { Events } from '../entity/Events'; // Updated import
import { CompanyMember } from '../entity/CompanyMember';
import { EventAssignment } from '../entity/EventAssignment'; // New import
import { CustomReminder } from '../entity/CustomReminder';
import { formatTime } from '../helper/helper';
import { format } from "date-fns";

export class CronWorker {
    start() {
        cron.schedule(
            '12 11 * * *', this.sendEventReminders.bind(this)
            // ,
            // {
            //     timezone: 'Europe/London'
            // }
        );

         cron.schedule(
            '0 * * * *', // Run at minute 0 of every hour
            this.sendCustomReminders.bind(this),
            {
                timezone: 'Europe/London'
            }
        );
        console.log('Cron jobs initialized successfully');
    }

    private async sendEventReminders() {
        const startTime = new Date();
        console.log(`\nEvent Reminder Cron Jobs started!`);

        try {
            const eventsRepo = AppDataSource.getRepository(Events);
            const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
            const eventAssignmentRepo = AppDataSource.getRepository(EventAssignment);
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

            // Find events happening in 1 or 7 days
            const upcomingEvents = await eventsRepo
                .createQueryBuilder('event')
                .leftJoinAndSelect('event.project', 'project')
                .leftJoinAndSelect('project.company', 'company')
                .where('event.date IN (:...dates)', { dates: [oneWeekFromNowStr, oneDayFromNowStr] })
                .andWhere('event.reminders IS NOT NULL')
                .getMany();

            let totalEmailsSent = 0;
            let eventsWithReminders = 0;

            for (const event of upcomingEvents) {
                const daysUntilEvent = this.getDaysDifference(todayStr, event.date);

                // Only process events that are exactly 7 or 1 days away
                if (daysUntilEvent !== 7 && daysUntilEvent !== 1) {
                    continue;
                }

                const reminderType = daysUntilEvent === 7 ? 'weekBefore' : 'dayBefore';

                // Check if this specific reminder is enabled
                if (event.reminders && event.reminders[reminderType]) {
                    // Get all assignments for this event
                    const eventAssignments = await eventAssignmentRepo
                        .createQueryBuilder('assignment')
                        .leftJoinAndSelect('assignment.member', 'member')
                        .where('assignment.events = :eventId', { eventId: event.id })
                        .getMany();

                    let eventEmailsSent = 0;
                    const formattedEventDate = format(event.date, "do MMM yyyy");

                    for (const assignment of eventAssignments) {
                        if (assignment.member) {
                            try {
                                // Get company-specific member details - FIXED QUERY
                                const companyMember = await companyMemberRepo
                                    .createQueryBuilder('companyMember')
                                    .select(['companyMember.name', 'companyMember.id'])
                                    .leftJoin('companyMember.member', 'member')
                                    .leftJoin('companyMember.company', 'company')
                                    .where('member.id = :memberId', { memberId: assignment.member.id })
                                    .andWhere('company.id = :companyId', { companyId: event.project.company.id })
                                    .getOne();

                                const memberName = companyMember?.name;

                                // Send event reminder email
                                await sendEventReminderEmail(
                                    assignment.member.email,
                                    memberName,
                                    event.name || 'Event',
                                    event.project.name,
                                    formattedEventDate,
                                    formatTime(event.startHour),
                                    formatTime(event.endHour),
                                    event.location,
                                    event.project.company.name,
                                    reminderType,
                                    daysUntilEvent
                                );
                                eventEmailsSent++;
                                totalEmailsSent++;

                                console.log(`   ✅ Sent reminder to ${assignment.member.email} for event "${event.name}"`);

                            } catch (emailError) {
                                console.error(`     ❌ Failed to send email to ${assignment.member.email}:`, emailError.message || emailError);
                            }
                        }
                    }
                    eventsWithReminders++;

                    console.log(`   📊 Sent ${eventEmailsSent} reminder(s) for event "${event.name}" (${reminderType})`);

                } else {
                    console.log(`   ⚠️  ${reminderType} reminder is DISABLED for event "${event.name}", skipping...`);
                }
            }

            const endTime = new Date();
            const executionTime = endTime.getTime() - startTime.getTime();

            console.log(`\n📊 Event Reminder Cron Jobs Summary:`);
            console.log(`   Events processed: ${upcomingEvents.length}`);
            console.log(`   Events with reminders enabled: ${eventsWithReminders}`);
            console.log(`   Total emails sent: ${totalEmailsSent}`);
            console.log(`   Execution time: ${executionTime}ms`);
            console.log(`Event Reminder Cron Jobs completed!\n`);

        } catch (error) {
            console.error('Error in sendEventReminders:', error);
        }
    }

    private getDaysDifference(date1: string, date2: string): number {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        const diffTime = Math.abs(d2.getTime() - d1.getTime());
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return days;
    }
    private async sendCustomReminders() {
        const startTime = new Date();
        console.log(`\nCustom Reminder Cron Jobs started at ${startTime.toISOString()}!`);

        try {
            const customReminderRepo = AppDataSource.getRepository(CustomReminder);
            const eventsRepo = AppDataSource.getRepository(Events);
            const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
            const eventAssignmentRepo = AppDataSource.getRepository(EventAssignment);

            const now = new Date();
            const currentDate = now.toISOString().split('T')[0];
            const currentHour = now.getHours();

            // Find custom reminders that should be sent now
            const pendingReminders = await customReminderRepo
                .createQueryBuilder('customReminder')
                .leftJoinAndSelect('customReminder.event', 'event')
                .leftJoinAndSelect('event.project', 'project')
                .leftJoinAndSelect('project.company', 'company')
                .where('customReminder.reminderDate = :currentDate', { currentDate })
                .andWhere('customReminder.reminderHour = :currentHour', { currentHour })
                .andWhere('customReminder.isSent = false')
                .getMany();

            console.log(`Found ${pendingReminders.length} custom reminders to process`);

            let totalEmailsSent = 0;
            let remindersProcessed = 0;

            for (const customReminder of pendingReminders) {
                try {
                    const event = customReminder.event;

                    // Get all assignments for this event
                    const eventAssignments = await eventAssignmentRepo
                        .createQueryBuilder('assignment')
                        .leftJoinAndSelect('assignment.member', 'member')
                        .where('assignment.events = :eventId', { eventId: event.id })
                        .getMany();

                    let reminderEmailsSent = 0;
                    const formattedEventDate = format(event.date, "do MMM yyyy")

                    for (const assignment of eventAssignments) {
                        if (assignment.member) {
                            try {
                                // Get company-specific member details
                                const companyMember = await companyMemberRepo.findOne({
                                    where: {
                                        member: { id: assignment.member.id },
                                        company: { id: event.project.company.id }
                                    }
                                });

                                const memberName = companyMember?.name;

                                await sendEventReminderEmail(
                                    assignment.member.email,
                                    memberName,
                                    event.name || 'Event',
                                    event.project.name,
                                    formattedEventDate,
                                    formatTime(event.startHour),
                                    formatTime(event.endHour),
                                    event.location,
                                    event.project.company.name,
                                    'dayBefore', // Use dayBefore type for custom reminders
                                    1 // daysUntilEvent
                                );
                                reminderEmailsSent++;
                                totalEmailsSent++;

                            } catch (emailError) {
                                console.error(`     ❌ Failed to send custom reminder email to ${assignment.member.email}:`, emailError.message);
                            }
                        }
                    }

                    // Mark reminder as sent
                    customReminder.isSent = true;
                    customReminder.sentAt = new Date();
                    await customReminderRepo.save(customReminder);

                    remindersProcessed++;
                    console.log(`   ✅ Sent ${reminderEmailsSent} custom reminder(s) for event "${event.name}"`);

                } catch (error) {
                    console.error(`   ❌ Failed to process custom reminder ${customReminder.id}:`, error.message);
                }
            }

            const endTime = new Date();
            const executionTime = endTime.getTime() - startTime.getTime();

            console.log(`\n📊 Custom Reminder Cron Jobs Summary:`);
            console.log(`   Reminders processed: ${remindersProcessed}`);
            console.log(`   Total emails sent: ${totalEmailsSent}`);
            console.log(`   Execution time: ${executionTime}ms`);
            console.log(`Custom Reminder Cron Jobs completed!\n`);

        } catch (error) {
            console.error('Error in sendCustomReminders:', error);
        }
    }

    private formatDateCustom(dateInput: string | Date | undefined): string {
        if (!dateInput) return '';
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);

        const dd = String(d.getDate()).padStart(2, '0');
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const mmm = months[d.getMonth()];
        const yyyy = d.getFullYear();
        return `${dd} ${mmm} ${yyyy}`;
    }
}

// Start the cron worker
export const cronWorker = new CronWorker();