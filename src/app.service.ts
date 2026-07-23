import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello() {
    return {
      name: 'SC Exam AI Assessment API',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
