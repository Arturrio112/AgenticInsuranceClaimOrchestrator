export const logger = {
    info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta ? meta : ''),
    warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta ? meta : ''),
    error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta ? meta : ''),
    debug: (msg: string, meta?: any) => console.debug(`[DEBUG] ${msg}`, meta ? meta : ''),
};
