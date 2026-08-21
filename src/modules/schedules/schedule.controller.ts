import { Response } from 'express';
import { Role } from '@prisma/client';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import {
    copyWeekSchema,
    createCashAdvanceSchema,
    getWeekQuerySchema,
    listWeeksQuerySchema,
    memberMonthQuerySchema,
    monthQuerySchema,
    publishWeekSchema,
    setDeductionSchema,
    upsertCompensationSchema,
    upsertPresetSchema,
    upsertWeekSchema,
} from './schedule.schemas';
import { scheduleService, Viewer } from './schedule.service';

// Every handler resolves the viewer from the authenticated session, never from
// the request body — the service uses it to decide which pay columns to return.
const requireContext = (req: AuthRequest): { storeId: string; viewer: Viewer } => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    if (!userId) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    if (!req.storeRole) throw new AppError('FORBIDDEN', 'Not a member of this store', 403);
    return { storeId, viewer: { userId, role: req.storeRole as Role } };
};

export const getWeek = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const { weekStart } = getWeekQuerySchema.parse(req.query);
    const week = await scheduleService.getWeek(storeId, weekStart, viewer);
    res.status(200).json({ week });
});

export const listWeeks = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const { from, to, limit } = listWeeksQuerySchema.parse(req.query);
    const weeks = await scheduleService.listWeeks(storeId, viewer, from, to, limit);
    res.status(200).json({ weeks });
});

export const upsertWeek = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const body = upsertWeekSchema.parse(req.body);
    await scheduleService.upsertWeek(storeId, viewer.userId, body);
    const week = await scheduleService.getWeek(storeId, body.weekStart, viewer);
    res.status(200).json({ week });
});

export const publishWeek = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const { weekStart } = getWeekQuerySchema.parse(req.query);
    const { publish } = publishWeekSchema.parse(req.body);
    const week = await scheduleService.setPublished(storeId, weekStart, publish, viewer);
    res.status(200).json({ week });
});

export const deleteWeek = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const { weekStart } = getWeekQuerySchema.parse(req.query);
    await scheduleService.deleteWeek(storeId, weekStart);
    res.status(204).send();
});

export const copyWeek = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const { fromWeekStart, toWeekStart, overwrite } = copyWeekSchema.parse(req.body);
    await scheduleService.copyWeek(storeId, viewer.userId, fromWeekStart, toWeekStart, overwrite);
    const week = await scheduleService.getWeek(storeId, toWeekStart, viewer);
    res.status(200).json({ week });
});

export const getMonthSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const { year, month } = monthQuerySchema.parse(req.query);
    const summary = await scheduleService.monthSummary(storeId, year, month, viewer);
    res.status(200).json({ summary });
});

export const getStackedMonth = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const { year, month } = monthQuerySchema.parse(req.query);
    const stacked = await scheduleService.stackedMonth(storeId, year, month, viewer);
    res.status(200).json({ stacked });
});

export const getMemberMonth = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const { storeMemberId, year, month } = memberMonthQuerySchema.parse(req.query);
    const calendar = await scheduleService.memberMonth(storeId, storeMemberId, year, month, viewer);
    res.status(200).json({ calendar });
});

export const listMembers = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const members = await scheduleService.listMembers(storeId);
    res.status(200).json({ members });
});

// ── Shift presets ────────────────────────────────────────────────────────────

export const listPresets = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const presets = await scheduleService.listPresets(storeId);
    res.status(200).json({ presets });
});

export const createPreset = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const body = upsertPresetSchema.parse(req.body);
    const preset = await scheduleService.createPreset(storeId, body);
    res.status(201).json({ preset });
});

export const updatePreset = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const presetId = req.params.presetId;
    if (!presetId) throw new AppError('BAD_REQUEST', 'Preset is required', 400);
    const body = upsertPresetSchema.parse(req.body);
    await scheduleService.updatePreset(storeId, presetId, body);
    res.status(204).send();
});

export const deletePreset = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const presetId = req.params.presetId;
    if (!presetId) throw new AppError('BAD_REQUEST', 'Preset is required', 400);
    await scheduleService.deletePreset(storeId, presetId);
    res.status(204).send();
});

// ── Pay rates ────────────────────────────────────────────────────────────────

export const listCompensations = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const rates = await scheduleService.listCompensations(storeId);
    res.status(200).json({ rates });
});

export const setCompensation = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const storeMemberId = req.params.storeMemberId;
    if (!storeMemberId) throw new AppError('BAD_REQUEST', 'Staff member is required', 400);
    const body = upsertCompensationSchema.parse(req.body);
    const rate = await scheduleService.setCompensation(storeId, storeMemberId, viewer.userId, body);
    res.status(200).json({ rate });
});

// ── Cash advances ────────────────────────────────────────────────────────────

export const listCashAdvances = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const advances = await scheduleService.listCashAdvances(storeId, viewer);
    res.status(200).json({ advances });
});

export const createCashAdvance = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, viewer } = requireContext(req);
    const body = createCashAdvanceSchema.parse(req.body);
    const advance = await scheduleService.createCashAdvance(storeId, viewer.userId, body);
    res.status(201).json({ advance });
});

export const deleteCashAdvance = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const cashAdvanceId = req.params.cashAdvanceId;
    if (!cashAdvanceId) throw new AppError('BAD_REQUEST', 'Cash advance is required', 400);
    await scheduleService.deleteCashAdvance(storeId, cashAdvanceId);
    res.status(204).send();
});

export const setDeduction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const rowId = req.params.rowId;
    if (!rowId) throw new AppError('BAD_REQUEST', 'Schedule row is required', 400);
    const body = setDeductionSchema.parse(req.body);
    const deduction = await scheduleService.setDeduction(storeId, rowId, body);
    res.status(200).json({ deduction });
});

export const removeDeduction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = requireContext(req);
    const { rowId, deductionId } = req.params;
    if (!rowId || !deductionId) throw new AppError('BAD_REQUEST', 'Row and deduction are required', 400);
    await scheduleService.removeDeduction(storeId, rowId, deductionId);
    res.status(204).send();
});
