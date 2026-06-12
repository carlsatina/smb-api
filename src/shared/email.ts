import nodemailer from 'nodemailer';
import { env } from '../config/env';

let cachedTransport: nodemailer.Transporter | null = null;

const BRAND_NAME = 'SmB-PoS';
const BRAND_SUBTITLE = 'Sales & Inventory';

const getTransport = () => {
    if (cachedTransport) return cachedTransport;
    if (!env.smtpHost || !env.smtpFrom) {
        return null;
    }
    const transport = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        auth: env.smtpUser && env.smtpPass ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
    cachedTransport = transport;
    return transport;
};

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const formatDateTime = (value: Date) => value.toLocaleString();

const buildStyledEmail = (payload: {
    subject: string;
    preheader: string;
    eyebrow: string;
    title: string;
    body: string[];
    ctaLabel: string;
    ctaLink: string;
    expiresLabel?: string;
    note: string;
}) => {
    const year = new Date().getFullYear();
    const bodyHtml = payload.body
        .map(
            (line) =>
                `<p style="margin:0 0 14px; color:#475569; font-size:15px; line-height:1.6;">${escapeHtml(
                    line
                )}</p>`
        )
        .join('');

    const expiresBlock = payload.expiresLabel
        ? `
            <div style="margin:20px 0; padding:14px 16px; background:#f8fafc; border-radius:12px; font-size:13px; color:#475569;">
                <strong style="color:#0f172a;">Link expires:</strong> ${escapeHtml(payload.expiresLabel)}
            </div>
          `
        : '';

    const html = `
        <!doctype html>
        <html>
            <head>
                <meta name="viewport" content="width=device-width" />
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                <title>${escapeHtml(payload.subject)}</title>
            </head>
            <body style="margin:0; background-color:#f1f5f9; font-family:Segoe UI, Helvetica, Arial, sans-serif;">
                <span style="display:none; visibility:hidden; opacity:0; color:transparent; height:0; width:0;">${escapeHtml(
                    payload.preheader
                )}</span>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:20px; overflow:hidden; border:1px solid #e2e8f0; box-shadow:0 20px 40px rgba(15, 23, 42, 0.08);">
                                <tr>
                                    <td style="padding:22px 28px; background:linear-gradient(135deg, #0f766e, #115e59); color:#ffffff;">
                                        <div style="font-size:18px; font-weight:700; letter-spacing:-0.02em;">${BRAND_NAME}</div>
                                        <div style="font-size:11px; text-transform:uppercase; letter-spacing:3px; opacity:0.85;">${BRAND_SUBTITLE}</div>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:28px;">
                                        <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#0f766e; font-weight:600;">${escapeHtml(
                                            payload.eyebrow
                                        )}</div>
                                        <h1 style="margin:8px 0 12px; font-size:22px; color:#0f172a;">${escapeHtml(
                                            payload.title
                                        )}</h1>
                                        ${bodyHtml}
                                        <table role="presentation" cellspacing="0" cellpadding="0">
                                            <tr>
                                                <td>
                                                    <a href="${payload.ctaLink}" style="display:inline-block; background:#0f766e; color:#ffffff; text-decoration:none; padding:12px 20px; border-radius:999px; font-weight:600; font-size:14px;">${escapeHtml(
                                                        payload.ctaLabel
                                                    )}</a>
                                                </td>
                                            </tr>
                                        </table>
                                        <p style="margin:16px 0 0; font-size:12px; color:#64748b;">If the button does not work, copy and paste this link:</p>
                                        <p style="margin:0 0 8px; font-size:12px; color:#0f766e; word-break:break-all;"><a href="${payload.ctaLink}" style="color:#0f766e;">${payload.ctaLink}</a></p>
                                        ${expiresBlock}
                                        <p style="margin:0; font-size:12px; color:#94a3b8;">${escapeHtml(
                                            payload.note
                                        )}</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:16px 28px; background:#f8fafc; font-size:11px; color:#94a3b8;">
                                        Need help? Reply to this email.
                                    </td>
                                </tr>
                            </table>
                            <div style="font-size:11px; color:#94a3b8; padding-top:10px;">(c) ${year} ${BRAND_NAME}. All rights reserved.</div>
                        </td>
                    </tr>
                </table>
            </body>
        </html>
    `;

    const textLines = [
        payload.title,
        '',
        ...payload.body,
        '',
        `${payload.ctaLabel}: ${payload.ctaLink}`,
        payload.expiresLabel ? `Expires: ${payload.expiresLabel}` : null,
        '',
        payload.note,
    ];

    const text = textLines.filter((line): line is string => Boolean(line)).join('\n');

    return { subject: payload.subject, text, html };
};

const buildInviteMessage = (payload: {
    storeName: string;
    role: string;
    invitedBy?: string | null;
    inviteLink: string;
    expiresAt: Date;
}) => {
    const expiresLabel = formatDateTime(payload.expiresAt);
    const inviter = payload.invitedBy ? `Invited by ${payload.invitedBy}.` : 'You have been invited.';

    return buildStyledEmail({
        subject: `Invite to join ${payload.storeName}`,
        preheader: `Join ${payload.storeName} on SmB-PoS.`,
        eyebrow: 'Store invite',
        title: `You are invited to ${payload.storeName}`,
        body: [
            `You have been invited to join ${payload.storeName} as ${payload.role}.`,
            inviter,
        ],
        ctaLabel: 'Accept invite',
        ctaLink: payload.inviteLink,
        expiresLabel,
        note: 'If you were not expecting this invite, you can safely ignore this email.',
    });
};

const buildPasswordResetMessage = (payload: { resetLink: string; expiresAt: Date }) => {
    const expiresLabel = formatDateTime(payload.expiresAt);
    return buildStyledEmail({
        subject: 'Reset your password',
        preheader: 'Reset your SmB-PoS password securely.',
        eyebrow: 'Security',
        title: 'Reset your password',
        body: [
            'We received a request to reset the password for your SmB-PoS account.',
            'Use the button below to set a new password and return to your POS workflows.',
        ],
        ctaLabel: 'Reset password',
        ctaLink: payload.resetLink,
        expiresLabel,
        note: 'If you did not request this, you can safely ignore this email.',
    });
};

const buildVerifyEmailMessage = (payload: { verifyLink: string; expiresAt?: Date }) => {
    return buildStyledEmail({
        subject: 'Verify your email',
        preheader: 'Confirm your email to activate your SmB-PoS account.',
        eyebrow: 'Welcome',
        title: 'Verify your email',
        body: [
            'Thanks for signing up for SmB-PoS.',
            'Confirm your email address to activate your account and start managing stores.',
        ],
        ctaLabel: 'Verify email',
        ctaLink: payload.verifyLink,
        expiresLabel: payload.expiresAt ? formatDateTime(payload.expiresAt) : undefined,
        note: 'If you did not create an account, you can ignore this email.',
    });
};

const formatPeso = (amount: number) =>
    `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const buildBillingMessage = (payload: {
    storeName: string;
    periodLabel: string;
    receiptCount: number;
    feeRate: number;
    amount: number;
    appLink: string;
}) => {
    return buildStyledEmail({
        subject: `Billing summary for ${payload.storeName} — ${payload.periodLabel}`,
        preheader: `Your ${payload.periodLabel} usage summary for ${payload.storeName}.`,
        eyebrow: 'Billing',
        title: `${payload.periodLabel} billing summary`,
        body: [
            `Here is the usage summary for ${payload.storeName} for ${payload.periodLabel}.`,
            `Receipts processed: ${payload.receiptCount.toLocaleString('en-PH')}`,
            `Convenience fee: ${formatPeso(payload.feeRate)} per receipt`,
            `Total amount due: ${formatPeso(payload.amount)}`,
        ],
        ctaLabel: 'Open SmB-PoS',
        ctaLink: payload.appLink,
        note: 'Please settle this amount at your earliest convenience. Reply to this email if you have any questions about your billing.',
    });
};

const sendViaResend = async (to: string, message: { subject: string; text: string; html: string }) => {
    if (!env.resendApiKey || !env.resendFrom) {
        return { sent: false };
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.resendApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: env.resendFrom,
            to,
            subject: message.subject,
            html: message.html,
            text: message.text,
        }),
    });

    if (!response.ok) {
        return { sent: false };
    }

    return { sent: true };
};

export const sendInviteEmail = async (payload: {
    to: string;
    storeName: string;
    role: string;
    invitedBy?: string | null;
    inviteLink: string;
    expiresAt: Date;
}) => {
    const message = buildInviteMessage(payload);
    const resendResult = await sendViaResend(payload.to, message);
    if (resendResult.sent) {
        return resendResult;
    }

    const transport = getTransport();
    if (!transport || !env.smtpFrom) {
        return { sent: false };
    }

    await transport.sendMail({
        from: env.smtpFrom,
        to: payload.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
    });

    return { sent: true };
};

export const sendPasswordResetEmail = async (payload: {
    to: string;
    resetLink: string;
    expiresAt: Date;
}) => {
    const message = buildPasswordResetMessage(payload);
    const resendResult = await sendViaResend(payload.to, message);
    if (resendResult.sent) {
        return resendResult;
    }

    const transport = getTransport();
    if (!transport || !env.smtpFrom) {
        return { sent: false };
    }

    await transport.sendMail({
        from: env.smtpFrom,
        to: payload.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
    });

    return { sent: true };
};

export const sendBillingEmail = async (payload: {
    to: string;
    storeName: string;
    periodLabel: string;
    receiptCount: number;
    feeRate: number;
    amount: number;
    appLink: string;
}) => {
    const message = buildBillingMessage(payload);
    const resendResult = await sendViaResend(payload.to, message);
    if (resendResult.sent) {
        return resendResult;
    }

    const transport = getTransport();
    if (!transport || !env.smtpFrom) {
        return { sent: false };
    }

    await transport.sendMail({
        from: env.smtpFrom,
        to: payload.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
    });

    return { sent: true };
};

export const sendVerificationEmail = async (payload: {
    to: string;
    verifyLink: string;
    expiresAt?: Date;
}) => {
    const message = buildVerifyEmailMessage(payload);
    const resendResult = await sendViaResend(payload.to, message);
    if (resendResult.sent) {
        return resendResult;
    }

    const transport = getTransport();
    if (!transport || !env.smtpFrom) {
        return { sent: false };
    }

    await transport.sendMail({
        from: env.smtpFrom,
        to: payload.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
    });

    return { sent: true };
};
