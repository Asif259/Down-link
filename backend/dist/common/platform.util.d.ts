export type SupportedPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'unknown';
export declare function detectPlatform(rawUrl: string): SupportedPlatform;
