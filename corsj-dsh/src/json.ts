/** JSON 值类型（IPC 载荷的无损约束）。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
