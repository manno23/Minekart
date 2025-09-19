export interface System {
  update(world: World, dt: number): void;
}

export class World {
  private nextEntityId = 1;
  private stores = new Map<string, Map<number, unknown>>();
  private tags = new Map<number, Set<string>>();

  createEntity(tags: string[] = []): number {
    const id = this.nextEntityId++;
    if (tags.length) {
      this.tags.set(id, new Set(tags));
    }
    return id;
  }

  destroyEntity(entity: number): void {
    for (const store of this.stores.values()) {
      store.delete(entity);
    }
    this.tags.delete(entity);
  }

  addComponent<T>(entity: number, key: string, value: T): void {
    let store = this.stores.get(key);
    if (!store) {
      store = new Map<number, T>();
      this.stores.set(key, store);
    }
    store.set(entity, value);
  }

  getComponent<T>(entity: number, key: string): T | undefined {
    return this.stores.get(key)?.get(entity) as T | undefined;
  }

  removeComponent(entity: number, key: string): void {
    this.stores.get(key)?.delete(entity);
  }

  hasComponent(entity: number, key: string): boolean {
    return this.stores.get(key)?.has(entity) ?? false;
  }

  tag(entity: number, label: string): void {
    let tagSet = this.tags.get(entity);
    if (!tagSet) {
      tagSet = new Set();
      this.tags.set(entity, tagSet);
    }
    tagSet.add(label);
  }

  hasTag(entity: number, label: string): boolean {
    return this.tags.get(entity)?.has(label) ?? false;
  }

  *view<T extends Record<string, unknown>>(components: (keyof T & string)[]): Iterable<{ entity: number; components: T }> {
    if (components.length === 0) {
      return;
    }
    const [first, ...rest] = components;
    const primary = this.stores.get(first);
    if (!primary) {
      return;
    }
    for (const [entity, value] of primary.entries()) {
      let valid = true;
      const values: Record<string, unknown> = { [first]: value };
      for (const key of rest) {
        const store = this.stores.get(key);
        if (!store || !store.has(entity)) {
          valid = false;
          break;
        }
        values[key] = store.get(entity);
      }
      if (valid) {
        yield { entity, components: values as T };
      }
    }
  }
}
