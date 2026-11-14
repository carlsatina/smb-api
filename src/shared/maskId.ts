/** Shows only the last 4 characters of an ID number: OSCA-123456 → *******3456. */
export const maskIdNumber = (value: string | null) => {
    if (!value) return value;
    const visible = value.slice(-4);
    return `${'*'.repeat(Math.max(value.length - 4, 4))}${visible}`;
};
