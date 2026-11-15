export declare class ExtractMediaDto {
    url: string;
}
export declare class DownloadQueryDto {
    url: string;
    formatId: string;
    type: 'video' | 'audio';
    jobId?: string;
}
