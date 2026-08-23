import { beforeEach, describe, expect, it } from 'vitest';
import { Role, ScheduleWeekStatus, TimeEntrySource } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

// The store runs on Asia/Manila (+8), so a 9AM local punch is 01:00Z. Fixed
// instants keep the reconciliation assertions independent of when tests run.
const WEEK_START = '2026-06-07'; // a Sunday, as the API requires
const WORK_DATE = '2026-06-10';
const manilaInstant = (time: string) => new Date(`${WORK_DATE}T${time}+08:00`);

const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

const rosterShift = async (storeId: string, storeMemberId: string, ownerId: string) => {
    const week = await prisma.scheduleWeek.create({
        data: {
            storeId,
            weekStart: utcMidnight(WEEK_START),
            status: ScheduleWeekStatus.PUBLISHED,
            publishedAt: new Date(),
            createdById: ownerId,
        },
    });
    const row = await prisma.scheduleWeekRow.create({
        data: { scheduleWeekId: week.id, storeMemberId },
    });
    // 9AM - 6PM, the pattern the payroll sheet uses.
    await prisma.scheduleShift.create({
        data: { scheduleWeekRowId: row.id, date: utcMidnight(WORK_DATE), startMinute: 540, endMinute: 1080 },
    });
    return { week, row };
};

describe('time clock', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('clocks a staff member in and out, and refuses a second open punch', async () => {
        const { user: owner } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff, password } = await createUser();
        const member = await prisma.storeMember.create({
            data: { storeId: store.id, userId: staff.id, role: Role.CASHIER },
        });

        const agent = createTestApp();
        const token = await login(agent, staff.email, password);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        const before = await auth(agent.get(`/api/v1/stores/${store.id}/schedule/attendance/me`));
        expect(before.status).toBe(200);
        expect(before.body.attendance.openEntry).toBeNull();
        expect(before.body.attendance.storeMemberId).toBe(member.id);

        const inRes = await auth(agent.post(`/api/v1/stores/${store.id}/schedule/attendance/clock-in`).send({}));
        expect(inRes.status).toBe(201);
        expect(inRes.body.attendance.openEntry).not.toBeNull();
        expect(inRes.body.attendance.reconciliation.status).toBe('OPEN');

        const again = await auth(agent.post(`/api/v1/stores/${store.id}/schedule/attendance/clock-in`).send({}));
        expect(again.status).toBe(409);
        expect(again.body.error?.code ?? again.body.code).toBe('ALREADY_CLOCKED_IN');

        const outRes = await auth(agent.post(`/api/v1/stores/${store.id}/schedule/attendance/clock-out`).send({}));
        expect(outRes.status).toBe(200);
        expect(outRes.body.attendance.openEntry).toBeNull();

        const stored = await prisma.timeEntry.findMany({ where: { storeMemberId: member.id } });
        expect(stored).toHaveLength(1);
        expect(stored[0].clockOutAt).not.toBeNull();
        expect(stored[0].source).toBe(TimeEntrySource.SELF);

        const orphan = await auth(agent.post(`/api/v1/stores/${store.id}/schedule/attendance/clock-out`).send({}));
        expect(orphan.status).toBe(409);
    });

    it('reconciles a punch against the rostered shift', async () => {
        const { user: owner, password } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff } = await createUser();
        const member = await prisma.storeMember.create({
            data: { storeId: store.id, userId: staff.id, role: Role.CASHIER },
        });
        await rosterShift(store.id, member.id, owner.id);
        // An hour of unpaid break, so 9AM-6PM is exactly one 8-hour day.
        await prisma.staffCompensation.create({
            data: {
                storeId: store.id,
                storeMemberId: member.id,
                dailyRate: 500,
                hoursPerDay: 8,
                breakMinutes: 60,
                otMultiplier: 1,
                effectiveFrom: utcMidnight('2026-01-01'),
                createdById: owner.id,
            },
        });

        // Timed in 20 minutes late, out on time.
        await prisma.timeEntry.create({
            data: {
                storeId: store.id,
                storeMemberId: member.id,
                workDate: utcMidnight(WORK_DATE),
                clockInAt: manilaInstant('09:20:00'),
                clockOutAt: manilaInstant('18:00:00'),
            },
        });

        const agent = createTestApp();
        const token = await login(agent, owner.email, password);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        const res = await auth(
            agent.get(`/api/v1/stores/${store.id}/schedule/attendance?from=${WEEK_START}&to=2026-06-13`)
        );
        expect(res.status).toBe(200);
        expect(res.body.attendance.canEdit).toBe(true);

        // The owner runs the store rather than working a shift, so they are not
        // a row in the grid — same rule the roster uses.
        expect(res.body.attendance.rows.map((r: any) => r.role)).toEqual(['CASHIER']);

        const row = res.body.attendance.rows.find((r: any) => r.storeMemberId === member.id);
        const day = row.days.find((d: any) => d.date === WORK_DATE);
        expect(day.status).toBe('LATE');
        expect(day.lateMinutes).toBe(20);
        expect(day.scheduledMinutes).toBe(480);
        expect(day.actualMinutes).toBe(460);
        expect(day.varianceMinutes).toBe(-20);
        expect(row.totals.actualHours).toBeCloseTo(7.67, 2);

        // The roster's own figures stay untouched — attendance only suggests.
        const week = await auth(
            agent.get(`/api/v1/stores/${store.id}/schedule/week?weekStart=${WEEK_START}`)
        );
        const weekRow = week.body.week.rows.find((r: any) => r.storeMemberId === member.id);
        expect(weekRow.pay.daysWorked).toBe(1);
        expect(weekRow.pay.hasAttendance).toBe(true);
        expect(weekRow.pay.actualDaysWorked).toBe(1);
        expect(weekRow.pay.actualHours).toBeCloseTo(7.67, 2);
        expect(weekRow.pay.actualOtHours).toBe(0);
    });

    it('keeps an overnight punch on the day the shift started', async () => {
        const { user: owner, password } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff } = await createUser();
        const member = await prisma.storeMember.create({
            data: { storeId: store.id, userId: staff.id, role: Role.CASHIER },
        });

        // 10PM Wednesday to 6AM Thursday, recorded against Wednesday.
        await prisma.timeEntry.create({
            data: {
                storeId: store.id,
                storeMemberId: member.id,
                workDate: utcMidnight(WORK_DATE),
                clockInAt: manilaInstant('22:00:00'),
                clockOutAt: new Date('2026-06-11T06:00:00+08:00'),
            },
        });

        const agent = createTestApp();
        const token = await login(agent, owner.email, password);
        const res = await agent
            .get(`/api/v1/stores/${store.id}/schedule/attendance?from=${WEEK_START}&to=2026-06-13`)
            .set('Authorization', `Bearer ${token}`);

        const row = res.body.attendance.rows.find((r: any) => r.storeMemberId === member.id);
        const wednesday = row.days.find((d: any) => d.date === WORK_DATE);
        const thursday = row.days.find((d: any) => d.date === '2026-06-11');

        expect(wednesday.actualMinutes).toBe(480);
        expect(wednesday.entries[0].inMinute).toBe(1320);
        expect(wednesday.entries[0].outMinute).toBe(1800); // past midnight, past 1440
        expect(thursday.actualMinutes).toBe(0);
    });

    it('shows staff only their own attendance, and refuses their corrections', async () => {
        const { user: owner } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff, password } = await createUser();
        const { user: other } = await createUser();
        const member = await prisma.storeMember.create({
            data: { storeId: store.id, userId: staff.id, role: Role.CASHIER },
        });
        const otherMember = await prisma.storeMember.create({
            data: { storeId: store.id, userId: other.id, role: Role.CASHIER },
        });

        const agent = createTestApp();
        const token = await login(agent, staff.email, password);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        const res = await auth(
            agent.get(`/api/v1/stores/${store.id}/schedule/attendance?from=${WEEK_START}&to=2026-06-13`)
        );
        expect(res.status).toBe(200);
        expect(res.body.attendance.canEdit).toBe(false);
        expect(res.body.attendance.rows).toHaveLength(1);
        expect(res.body.attendance.rows[0].storeMemberId).toBe(member.id);

        const peek = await auth(
            agent.get(
                `/api/v1/stores/${store.id}/schedule/attendance?from=${WEEK_START}&to=2026-06-13&storeMemberId=${otherMember.id}`
            )
        );
        expect(peek.status).toBe(403);

        const correction = await auth(
            agent.post(`/api/v1/stores/${store.id}/schedule/attendance`).send({
                storeMemberId: member.id,
                workDate: WORK_DATE,
                clockInMinute: 540,
                clockOutMinute: 1080,
            })
        );
        expect(correction.status).toBe(403);
    });

    it('lets a manager correct a punch and rejects an overlapping one', async () => {
        const { user: owner, password } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff } = await createUser();
        const member = await prisma.storeMember.create({
            data: { storeId: store.id, userId: staff.id, role: Role.CASHIER },
        });

        const agent = createTestApp();
        const token = await login(agent, owner.email, password);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        const created = await auth(
            agent.post(`/api/v1/stores/${store.id}/schedule/attendance`).send({
                storeMemberId: member.id,
                workDate: WORK_DATE,
                clockInMinute: 540,
                clockOutMinute: 1080,
                note: 'forgot to punch',
            })
        );
        expect(created.status).toBe(201);

        const stored = await prisma.timeEntry.findFirst({ where: { id: created.body.entry.id } });
        expect(stored?.source).toBe(TimeEntrySource.MANAGER);
        expect(stored?.editedById).toBe(owner.id);
        expect(stored?.clockInAt.toISOString()).toBe(manilaInstant('09:00:00').toISOString());

        const overlapping = await auth(
            agent.post(`/api/v1/stores/${store.id}/schedule/attendance`).send({
                storeMemberId: member.id,
                workDate: WORK_DATE,
                clockInMinute: 600,
                clockOutMinute: 900,
            })
        );
        expect(overlapping.status).toBe(409);

        const updated = await auth(
            agent.put(`/api/v1/stores/${store.id}/schedule/attendance/${created.body.entry.id}`).send({
                storeMemberId: member.id,
                workDate: WORK_DATE,
                clockInMinute: 540,
                clockOutMinute: 1140,
            })
        );
        expect(updated.status).toBe(200);

        const removed = await auth(
            agent.delete(`/api/v1/stores/${store.id}/schedule/attendance/${created.body.entry.id}`)
        );
        expect(removed.status).toBe(204);
        const after = await prisma.timeEntry.findMany({ where: { storeMemberId: member.id, deletedAt: null } });
        expect(after).toHaveLength(0);
    });
});
