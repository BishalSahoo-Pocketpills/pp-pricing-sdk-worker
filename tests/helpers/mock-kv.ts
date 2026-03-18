export class MockKV {
  private store = new Map<string, string>();

  async get(key: string, type?: string): Promise<any> {
    const value = this.store.get(key) ?? null;
    if (value === null) return null;
    if (type === 'json') return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[] }> {
    return {
      keys: [...this.store.keys()].map((name) => ({ name })),
    };
  }

  // Test helper — inspect raw store
  _raw(): Map<string, string> {
    return this.store;
  }

  _clear(): void {
    this.store.clear();
  }
}
