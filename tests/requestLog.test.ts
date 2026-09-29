import { expect, it } from 'vitest';
import { getRequestLog, levelForStatus, logRequest, serviceForPath } from '../src/api/requestLog';
it('keeps only the newest 200 entries', () => {
  for (let i = 0; i < 205; i++) logRequest({ level: 'INFO', method: 'GET', path: `/catalog/${i}`, code: '200', ms: 1 });
  expect(getRequestLog()).toHaveLength(200);
  expect(getRequestLog()[0].path).toBe('/catalog/204');
  expect(getRequestLog()[199].path).toBe('/catalog/5');
});
it('classifies status and route service', () => {
  expect(levelForStatus(401)).toBe('WARN');
  expect(levelForStatus(500)).toBe('ERROR');
  expect(serviceForPath('/catalog/albums')).toBe('catalog_service');
});
