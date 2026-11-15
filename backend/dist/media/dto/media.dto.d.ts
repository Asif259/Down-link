export declare class ExtractMediaDto {
    url: string;
}
export declare class DownloadQueryDto {
    url: string;
    formatId: string;
    type: 'video' | 'audio';
    jobId?: string;
}
export declare class UpdateCookiesDto {
    secret: string;
    cookies: string;
}
export declare class UpdateBinaryDto {
    secret: string;
}
