import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); localStorage.clear(); });

// Тестовая инфраструктура XHR. Две проблемы окружения, из-за которых uploadForm
// (XMLHttpRequest в api/http.ts) зависает в тестах:
// 1) msw не перехватывает неконфигурируемый глобал jsdom-XMLHttpRequest — запрос
//    уходит в никуда. Подменяем глобал своим классом и делаем его
//    неконфигурируемым, чтобы XMLHttpRequestInterceptor msw пропустил его.
// 2) fetch с jsdom-FormData внутри msw зависает на сериализации — поэтому
//    FormData собираем в multipart-строку сами.
class FetchXHR {
  status = 0;
  responseText = '';
  response = '';
  readyState = 0;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload = { onprogress: null as ((e: unknown) => void) | null, addEventListener() {}, removeEventListener() {} };
  private method = 'GET';
  private url = '';
  private headers: Record<string, string> = {};
  private controller: AbortController | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = new URL(url, window.location.href).toString();
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  abort() {
    this.controller?.abort();
    this.onabort?.();
  }
  async send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.controller = new AbortController();
    let payload: string | undefined;
    if (body instanceof FormData) {
      const { text, contentType } = await formDataToMultipartText(body);
      this.headers['Content-Type'] = contentType;
      payload = text;
    } else if (typeof body === 'string') {
      payload = body;
    }
    try {
      const res = await fetch(this.url, { method: this.method, headers: this.headers, body: payload, signal: this.controller.signal });
      this.status = res.status;
      this.responseText = await res.text();
      this.response = this.responseText;
      this.onload?.();
    } catch {
      this.onerror?.();
    }
  }
  addEventListener() {}
  removeEventListener() {}
}

const TEST_BOUNDARY = '----privyadmintest' + Math.random().toString(16).slice(2);

async function formDataToMultipartText(fd: FormData): Promise<{ text: string; contentType: string }> {
  let text = '';
  for (const [name, value] of fd.entries()) {
    if (value instanceof Blob) {
      const file = value as File;
      text += `--${TEST_BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${file.name ?? 'blob'}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`;
      // Тестовые файлы крошечные — байты в двоичную строку через FileReader
      // (Blob.arrayBuffer в jsdom не работает)
      text += (await blobToBinaryString(value)) + '\r\n';
    } else {
      text += `--${TEST_BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    }
  }
  text += `--${TEST_BOUNDARY}--\r\n`;
  return { text, contentType: `multipart/form-data; boundary=${TEST_BOUNDARY}` };
}

async function blobToBinaryString(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)));
    };
    reader.onerror = () => reject(new Error('blob read failed'));
    reader.readAsDataURL(blob);
  });
}

// configurable: false — принципиально: с конфигурируемым глобалом msw оборачивает
// класс своим XHR-интерсептором, чей send-хук зависает на сериализации
// jsdom-FormData. Неконфигурируемый глобал msw пропускает, и наш send работает.
Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: false, value: FetchXHR, writable: false });
