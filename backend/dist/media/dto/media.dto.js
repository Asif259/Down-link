"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateBinaryDto = exports.UpdateCookiesDto = exports.DownloadQueryDto = exports.ExtractMediaDto = void 0;
const class_validator_1 = require("class-validator");
class ExtractMediaDto {
}
exports.ExtractMediaDto = ExtractMediaDto;
__decorate([
    (0, class_validator_1.IsUrl)({ protocols: ['http', 'https'], require_protocol: true }),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ExtractMediaDto.prototype, "url", void 0);
class DownloadQueryDto {
}
exports.DownloadQueryDto = DownloadQueryDto;
__decorate([
    (0, class_validator_1.IsUrl)({ protocols: ['http', 'https'], require_protocol: true }),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], DownloadQueryDto.prototype, "url", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Matches)(/^[a-zA-Z0-9+_.\-\/\[\]=]+$/, {
        message: 'Invalid format identifier. Must only contain safe format specifier characters.',
    }),
    __metadata("design:type", String)
], DownloadQueryDto.prototype, "formatId", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['video', 'audio']),
    __metadata("design:type", String)
], DownloadQueryDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[a-zA-Z0-9_-]+$/),
    __metadata("design:type", String)
], DownloadQueryDto.prototype, "jobId", void 0);
class UpdateCookiesDto {
}
exports.UpdateCookiesDto = UpdateCookiesDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], UpdateCookiesDto.prototype, "secret", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], UpdateCookiesDto.prototype, "cookies", void 0);
class UpdateBinaryDto {
}
exports.UpdateBinaryDto = UpdateBinaryDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], UpdateBinaryDto.prototype, "secret", void 0);
//# sourceMappingURL=media.dto.js.map