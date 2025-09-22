/**
 * Code heavily based on https://github.com/dsherret/service-store/ - that project's original 
 * license is included below:
 * 
 * MIT License

Copyright (c) 2025 David Sherret

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { defineStore, type Store, StoreDefinition } from "./mod.ts";

Deno.test("StoreBuilder ctor", () => {
  assertThrows(
    () => new (StoreDefinition as any)(),
    Error,
    "Use the `defineStore` export instead.",
  );
});

Deno.test("adding", () => {
  let aCreatedTimes = 0;
  const store = defineStore()
    .add("A", () => {
      aCreatedTimes++;
      return { value: 5 };
    })
    .add("B", (store) => {
      return { a: store.get("A") };
    })
    .finalize();
  assertEquals(aCreatedTimes, 0);
  const a1 = store.get("A");
  assertEquals(aCreatedTimes, 1);
  const a2 = store.get("A");
  assertEquals(aCreatedTimes, 1);
  a1.value = 123;
  assertEquals(a2.value, 123);
  const b = store.get("B");
  assertEquals(b.a.value, 123);
  assertEquals(aCreatedTimes, 1);

  // @ts-expect-error ensure accessing an unknown property errors
  b.a.value2;
});

Deno.test("key not in store", () => {
  const store = defineStore().finalize();
  assertThrows(
    // @ts-expect-error "something" is not in the store
    () => store.get("something"),
    Error,
    "Store did not contain key: something",
  );
});

Deno.test("service defined multiple times", () => {
  assertThrows(
    () => defineStore().add("a", () => {}).add("a", () => {}),
    Error,
    "Service already defined: a",
  );
  assertThrows(
    () =>
      defineStore()
        .add("a", () => {})
        .finalize()
        .createChild()
        .add("a", () => {}),
    Error,
    "Service already defined: a",
  );
});

Deno.test("async", async () => {
  const store = defineStore()
    .add("A", () => {
      return Promise.resolve({ value: 5 });
    })
    .finalize();

  await assertPromise();
  await assertPromise();

  async function assertPromise() {
    const promise = store.get("A");
    assert(promise instanceof Promise);
    const value = await promise;
    assertEquals(value.value, 5);
  }
});

Deno.test("dispose", () => {
  let disposeCount = 0;
  {
    const disposableFactory = () => {
      return {
        [Symbol.dispose]() {
          disposeCount++;
        },
      };
    };
    using store = defineStore()
      .add("A", disposableFactory)
      .add("B", disposableFactory)
      .finalize();
    store.get("A"); // only create A
  }
  assertEquals(disposeCount, 1);
});

Deno.test("async dispose", async () => {
  let disposeCount = 0;
  const disposableFactory = () => {
    return {
      [Symbol.dispose]() {
        disposeCount++;
      },
    };
  };
  let asyncDisposeCount = 0;
  const asyncDisposableFactory = () => {
    return {
      [Symbol.asyncDispose]() {
        asyncDisposeCount++;
        return Promise.resolve();
      },
    };
  };
  {
    await using store = defineStore()
      .add("A", asyncDisposableFactory)
      .add("B", asyncDisposableFactory) // don't create
      .add("C", disposableFactory)
      .add("D", () => {
        // will prefer async
        return {
          ...disposableFactory(),
          ...asyncDisposableFactory(),
        };
      })
      .finalize();
    store.get("A");
    store.get("C");
    store.get("D");
  }
  assertEquals(asyncDisposeCount, 2);
  assertEquals(disposeCount, 1);
});

Deno.test("async dispose used in using", () => {
  assertThrows(
    () => {
      using store = defineStore()
        .add("A", () => {
          return {
            [Symbol.asyncDispose]() {
              return Promise.resolve();
            },
          };
        })
        .finalize();
      store.get("A");
    },
    Error,
    "Cannot dispose a container containing async disposables. Use `await using` instead of `using`.",
  );
});

Deno.test("transient", () => {
  let aCreatedTimes = 0;
  const store = defineStore()
    .addTransient("A", () => {
      aCreatedTimes++;
      return { value: 5 };
    })
    .add("B", (store) => {
      return store.get("A");
    })
    .finalize();
  assertEquals(aCreatedTimes, 0);
  const a1 = store.get("A");
  const a2 = store.get("A");
  assertEquals(aCreatedTimes, 2);
  a1.value = 123;
  assertEquals(a2.value, 5);
  const b1 = store.get("B");
  const b2 = store.get("B");
  b1.value = 123;
  assertEquals(b2.value, 123);
  assertEquals(aCreatedTimes, 3);
});

Deno.test("branching", () => {
  let aCreatedTimes = 0;
  let bCreatedTimes = 0;
  let cCreatedTimes = 0;
  const storeA = defineStore()
    .add("A", () => {
      aCreatedTimes++;
      return { value: 5 };
    })
    .finalize();

  const childB = storeA.createChild()
    .add("B", (store) => {
      assertEquals(store.get("A").value, 5);
      bCreatedTimes++;
      return 1;
    });
  const childC = storeA.createChild()
    .add("C", () => {
      cCreatedTimes++;
      return 2;
    });

  const storeB1 = childB.finalize();
  const storeB2 = childB.finalize();
  const storeC = childC.finalize();

  assertEquals(storeA.get("A").value, 5);
  assertEquals(storeB1.get("B"), 1);
  assertEquals(storeB2.get("B"), 1);
  assertEquals(storeC.get("C"), 2);

  assertEquals(aCreatedTimes, 1);
  assertEquals(bCreatedTimes, 2);
  assertEquals(cCreatedTimes, 1);
});

Deno.test("error", async () => {
  let i = 0;
  const store = defineStore()
    .add("a", async () => {
      i++;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (i === 1) {
        throw new Error("Error");
      }
      return 1;
    })
    .finalize();

  const errorPromise1 = store.get("a");
  const errorPromise2 = store.get("a");

  await assertRejects(() => errorPromise1);
  await assertRejects(() => errorPromise2);

  // will succeed after failing
  assertEquals(await store.get("a"), 1);
});

Deno.test("store can be typed easily", () => {
  interface Services {
    a: { value: 1 };
    b: { value: 2 };
  }

  function getDefinition(): StoreDefinition<Services> {
    return defineStore()
      .add("a", () => ({ value: 1 } as const))
      .add("b", () => ({ value: 2 } as const));
  }

  function getStore(): Store<Services> {
    return getDefinition().finalize();
  }

  const store = getStore();
  assertEquals(store.get("a").value, 1);
  assertEquals(store.get("b").value, 2);
});