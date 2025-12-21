// controller/customReminder.controller.ts
import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { CustomReminder } from "../../entity/CustomReminder";
import { Events } from "../../entity/Events";
import { Not } from "typeorm";

class CustomReminderController {
    public createCustomReminder = async (
        req: Request<{}, {}, { eventId: string; reminderDate: string; reminderHour: number }>,
        res: Response
    ) => {
        try {
            const { eventId, reminderDate, reminderHour } = req.body;

            if (!eventId || !reminderDate || reminderHour === undefined) {
                return res.status(400).json({
                    success: false,
                    message: "Event ID, reminder date and reminder hour are required"
                });
            }

            if (reminderHour < 0 || reminderHour > 23) {
                return res.status(400).json({
                    success: false,
                    message: "Reminder hour must be between 0 and 23"
                });
            }

            const eventsRepo = AppDataSource.getRepository(Events);
            const customReminderRepo = AppDataSource.getRepository(CustomReminder);

            const event = await eventsRepo.findOne({
                where: { id: eventId }
            });

            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: "Event not found"
                });
            }

            // Parse reminder date and time
            const reminderDateTime = new Date(reminderDate);
            reminderDateTime.setHours(reminderHour, 0, 0, 0);

            // Parse event date and time
            const eventDateTime = new Date(event.date);
            eventDateTime.setHours(event.startHour, 0, 0, 0);

            // Check if reminder is set after event
            if (reminderDateTime >= eventDateTime) {
                return res.status(400).json({
                    success: false,
                    message: "Reminder must be set before the event starts"
                });
            }

            // Check if reminder is in the past
            const now = new Date();
            const reminder = new Date(reminderDateTime);


            // if (isNaN(reminder.getTime())) {
            //     return res.status(400).json({
            //         success: false,
            //         message: "Invalid reminder date"
            //     });
            // }

            // if (reminder.getTime() <= now.getTime()) {
            //     return res.status(400).json({
            //         success: false,
            //         message: "Cannot set reminders in the past"
            //     });
            // }

            // Check for duplicate reminders at same date and hour
            const existingReminder = await customReminderRepo.findOne({
                where: {
                    event: { id: eventId },
                    reminderDate,
                    reminderHour
                }
            });

            if (existingReminder) {
                return res.status(400).json({
                    success: false,
                    message: "A reminder already exists for this date and time"
                });
            }

            const customReminder = customReminderRepo.create({
                event,
                reminderDate,
                reminderHour,
                isSent: false
            });

            const savedReminder = await customReminderRepo.save(customReminder);

            return res.status(201).json({
                success: true,
                message: "Custom reminder created successfully",
                customReminder: savedReminder
            });

        } catch (error) {
            console.error("Error creating custom reminder:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while creating custom reminder"
            });
        }
    };

    public getEventCustomReminders = async (
        req: Request<{ eventId: string }, {}, {}>,
        res: Response
    ) => {
        try {
            const { eventId } = req.params;

            const customReminderRepo = AppDataSource.getRepository(CustomReminder);

            const reminders = await customReminderRepo.find({
                where: { event: { id: eventId } },
                relations: ['event'],
                order: { reminderDate: 'ASC', reminderHour: 'ASC' }
            });

            return res.status(200).json({
                success: true,
                message: "Custom reminders retrieved successfully",
                reminders: reminders
            });

        } catch (error) {
            console.error("Error getting custom reminders:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while fetching custom reminders"
            });
        }
    };

    public getAllCustomReminders = async (
        req: Request,
        res: Response
    ) => {
        try {
            const customReminderRepo = AppDataSource.getRepository(CustomReminder);

            const reminders = await customReminderRepo.find({
                relations: ['event', 'event.project'],
                order: { reminderDate: 'ASC', reminderHour: 'ASC' }
            });

            return res.status(200).json({
                success: true,
                message: "All custom reminders retrieved successfully",
                reminders: reminders
            });

        } catch (error) {
            console.error("Error getting all custom reminders:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while fetching all custom reminders"
            });
        }
    };
    public updateCustomReminder = async (
        req: Request<{ id: string }, {}, { reminderDate?: string; reminderHour?: number }>,
        res: Response
    ) => {
        try {
            const { id } = req.params;
            const { reminderDate, reminderHour } = req.body;

            const customReminderRepo = AppDataSource.getRepository(CustomReminder);
            const eventsRepo = AppDataSource.getRepository(Events);

            const reminder = await customReminderRepo.findOne({
                where: { id },
                relations: ['event']
            });

            if (!reminder) {
                return res.status(404).json({
                    success: false,
                    message: "Custom reminder not found"
                });
            }

            // If updating date or hour, validate against event time
            if (reminderDate !== undefined || reminderHour !== undefined) {
                const newReminderDate = reminderDate || reminder.reminderDate;
                const newReminderHour = reminderHour !== undefined ? reminderHour : reminder.reminderHour;

                if (newReminderHour < 0 || newReminderHour > 23) {
                    return res.status(400).json({
                        success: false,
                        message: "Reminder hour must be between 0 and 23"
                    });
                }

                // Parse reminder date and time
                const reminderDateTime = new Date(newReminderDate);
                reminderDateTime.setHours(newReminderHour, 0, 0, 0);

                // Parse event date and time
                const eventDateTime = new Date(reminder.event.date);
                eventDateTime.setHours(reminder.event.startHour, 0, 0, 0);

                // Check if reminder is set after event
                if (reminderDateTime >= eventDateTime) {
                    return res.status(400).json({
                        success: false,
                        message: "Reminder must be set before the event starts"
                    });
                }

                // Check if reminder is in the past (only if not already sent)
                // const now = new Date();
                // if (reminderDateTime < now && !reminder.isSent) {
                //     return res.status(400).json({
                //         success: false,
                //         message: "Cannot set reminders in the past"
                //     });
                // }

                // Check for duplicate reminders (excluding current one)
                const existingReminder = await customReminderRepo.findOne({
                    where: {
                        event: { id: reminder.event.id },
                        reminderDate: newReminderDate,
                        reminderHour: newReminderHour,
                        id: Not(id)
                    }
                });

                if (existingReminder) {
                    return res.status(400).json({
                        success: false,
                        message: "Another reminder already exists for this date and time"
                    });
                }

                reminder.reminderDate = newReminderDate;
                reminder.reminderHour = newReminderHour;
            }

            // Reset sent status if date or hour is changed
            if ((reminderDate !== undefined && reminderDate !== reminder.reminderDate) ||
                (reminderHour !== undefined && reminderHour !== reminder.reminderHour)) {
                reminder.isSent = false;
                reminder.sentAt = null;
            }

            const updatedReminder = await customReminderRepo.save(reminder);

            return res.status(200).json({
                success: true,
                message: "Custom reminder updated successfully",
                customReminder: updatedReminder
            });

        } catch (error) {
            console.error("Error updating custom reminder:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while updating custom reminder"
            });
        }
    };

    public deleteCustomReminder = async (
        req: Request<{ id: string }, {}, {}>,
        res: Response
    ) => {
        try {
            const { id } = req.params;
            const customReminderRepo = AppDataSource.getRepository(CustomReminder);

            const result = await customReminderRepo.delete(id);

            if (result.affected === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Custom reminder not found"
                });
            }

            return res.status(200).json({
                success: true,
                message: "Custom reminder deleted successfully"
            });

        } catch (error) {
            console.error("Error deleting custom reminder:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while deleting custom reminder"
            });
        }
    };

    public toggleReminderSentStatus = async (
        req: Request<{ id: string }, {}, { isSent: boolean }>,
        res: Response
    ) => {
        try {
            const { id } = req.params;
            const { isSent } = req.body;

            if (typeof isSent !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    message: "isSent must be a boolean"
                });
            }

            const customReminderRepo = AppDataSource.getRepository(CustomReminder);

            const reminder = await customReminderRepo.findOne({
                where: { id }
            });

            if (!reminder) {
                return res.status(404).json({
                    success: false,
                    message: "Custom reminder not found"
                });
            }

            reminder.isSent = isSent;
            if (isSent) {
                reminder.sentAt = new Date();
            } else {
                reminder.sentAt = null;
            }

            const updatedReminder = await customReminderRepo.save(reminder);

            return res.status(200).json({
                success: true,
                message: isSent ? "Custom reminder marked as sent" : "Custom reminder marked as unsent",
                customReminder: updatedReminder
            });

        } catch (error) {
            console.error("Error toggling reminder status:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while toggling reminder status"
            });
        }
    };

    public getPendingCustomReminders = async (
        req: Request,
        res: Response
    ) => {
        try {
            const customReminderRepo = AppDataSource.getRepository(CustomReminder);

            const now = new Date();
            const currentDate = now.toISOString().split('T')[0];
            const currentHour = now.getHours();

            const pendingReminders = await customReminderRepo
                .createQueryBuilder('customReminder')
                .leftJoinAndSelect('customReminder.event', 'event')
                .leftJoinAndSelect('event.project', 'project')
                .leftJoinAndSelect('project.company', 'company')
                .where('customReminder.reminderDate = :currentDate', { currentDate })
                .andWhere('customReminder.reminderHour = :currentHour', { currentHour })
                .andWhere('customReminder.isSent = false')
                .getMany();

            return res.status(200).json({
                success: true,
                message: "Pending custom reminders retrieved successfully",
                reminders: pendingReminders,
                count: pendingReminders.length
            });

        } catch (error) {
            console.error("Error getting pending custom reminders:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while fetching pending custom reminders"
            });
        }
    };
}

export default new CustomReminderController();