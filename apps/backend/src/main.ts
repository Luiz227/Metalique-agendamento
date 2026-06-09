import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        'https://sistema-metalique-agenda-frontend.eweu2u.easypanel.host',
        'https://sistema-metalique-web-agendamento.eweu2u.easypanel.host',
        'http://localhost:5173',
        'http://localhost:3000'
      ];

      const isEasypanelHost = /^https:\/\/[a-z0-9-]+\.eweu2u\.easypanel\.host$/i.test(origin);
      if (allowedOrigins.includes(origin) || isEasypanelHost) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition', 'Content-Type'],
    credentials: true
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.PORT ?? 3333));
}

bootstrap();
