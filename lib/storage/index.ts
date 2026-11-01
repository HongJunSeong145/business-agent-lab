import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { uuidv7 } from "uuidv7";
import { prisma } from "@/lib/db";

/**
 * 파일 저장소 추상화 (지시서 3-2, ADR-020).
 *  - local: ./storage (개발·테스트)
 *  - db:    Postgres stored_files (개인용 배포 기본 — 재배포에도 유지)
 *  - s3:    운영 확장용(미구현 — 선택 시 명확한 오류)
 * 저장 키는 무작위(uuidv7)이며 원래 파일명은 키에 넣지 않는다(10-3).
 */
export interface Storage {
  readonly driver: "local" | "db" | "s3";
  put(key: string, data: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export function newStorageKey(prefix: string, now = new Date()): string {
  const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}/${ym}/${uuidv7()}`;
}

const KEY_RE = /^[a-z0-9-]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/;
export function isValidStorageKey(key: string): boolean {
  return KEY_RE.test(key);
}

class LocalStorage implements Storage {
  readonly driver = "local" as const;
  constructor(private readonly root: string) {}
  private file(key: string) {
    if (!isValidStorageKey(key)) throw new Error("잘못된 저장 키");
    return path.join(this.root, key);
  }
  async put(key: string, data: Uint8Array) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

class DbStorage implements Storage {
  readonly driver = "db" as const;
  async put(key: string, data: Uint8Array, mime: string) {
    if (!isValidStorageKey(key)) throw new Error("잘못된 저장 키");
    await prisma.storedFile.create({ data: { storage_key: key, data: Buffer.from(data), mime, size: BigInt(data.byteLength) } });
  }
  async get(key: string) {
    const f = await prisma.storedFile.findUnique({ where: { storage_key: key } });
    return f ? new Uint8Array(f.data) : null;
  }
  async delete(key: string) {
    await prisma.storedFile.deleteMany({ where: { storage_key: key } });
  }
}

let instance: Storage | null = null;

export function getStorage(): Storage {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER ?? "db";
  if (driver === "local") instance = new LocalStorage(path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_STORAGE_DIR ?? "storage"));
  else if (driver === "db") instance = new DbStorage();
  else throw new Error("STORAGE_DRIVER=s3 는 아직 구현되지 않았습니다. local 또는 db 를 사용하세요.");
  return instance;
}
