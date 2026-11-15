"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const logger = new common_1.Logger('Bootstrap');
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.set('trust proxy', 1);
    const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
    const allowedOrigins = allowedOriginsEnv
        ? allowedOriginsEnv.split(',').map((o) => o.trim())
        : ['http://localhost:3000', 'http://localhost:3001'];
    app.enableCors({
        origin: (origin, callback) => {
            if (!origin || !allowedOriginsEnv || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
        },
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: false,
        exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Range'],
    });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
    }));
    const port = process.env.PORT || 3000;
    await app.listen(port, '0.0.0.0');
    logger.log(`Media Downloader API running on port ${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map