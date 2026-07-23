import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeRunnerService } from './code-runner.service';

describe('CodeRunnerService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('executes code and normalizes a successful Piston result', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'PISTON_BASE_URL' ? 'http://127.0.0.1:2000/api/v2/' : fallback,
      ),
    } as unknown as ConfigService;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          run: {
            stdout: 'Hello\n',
            stderr: '',
            code: 0,
            signal: null,
            status: null,
            cpu_time: 12,
            memory: 2_048_000,
          },
          language: 'python',
          version: '3.12.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await new CodeRunnerService(config).run(
      'PYTHON',
      'print("Hello")',
    );

    expect(result).toMatchObject({
      statusId: 3,
      status: 'สำเร็จ',
      stdout: 'Hello\n',
      time: 0.012,
      memory: 2000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:2000/api/v2/execute',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports a clear error when Piston is not configured', async () => {
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    await expect(
      new CodeRunnerService(config).run('CPP', 'int main() {}'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('queues runs after two active requests', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'PISTON_BASE_URL' ? 'http://127.0.0.1:2000/api/v2' : fallback,
      ),
    } as unknown as ConfigService;
    const releases: Array<() => void> = [];
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(() =>
            resolve(
              new Response(JSON.stringify({ run: { stdout: 'ok', code: 0 } }), {
                status: 200,
              }),
            ),
          );
        }),
    );
    const service = new CodeRunnerService(config);

    const first = service.run('PYTHON', 'print(1)');
    const second = service.run('PYTHON', 'print(2)');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const third = service.run('PYTHON', 'print(3)');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    releases.splice(0).forEach((release) => release());

    await expect(Promise.all([first, second, third])).resolves.toHaveLength(3);
  });
});
