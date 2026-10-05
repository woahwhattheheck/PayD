# Frontend hook tests

Run from `frontend/`:

```sh
npm ci --legacy-peer-deps --ignore-scripts
npm run test:hooks
```

The isolated Vitest configuration does not load the application's WASM plugins or generated contract clients. Tests mount real React hooks with React Testing Library. Fee estimation also runs the real fee service and React Query client; only its HTTP boundary is mocked. Wallet, anchor, socket, and Soroban RPC boundaries are mocked, so this suite never signs or submits a real transaction.

Coverage follows issue #534 and includes all 13 hooks currently in `src/hooks/`: context guards and updates; autosave debounce and cleanup; portal fetching, filtering, pagination and errors; fee calculations and polling; withdrawal validation, completion and cancellation; error parsing state; simulation state; signing state; batch updates and retries; and contract invocation sequencing.

The portal currently generates demonstration transactions. Its tests explicitly treat those as demonstration data, not evidence of a live employee-payment API. SDK mocks in the Soroban tests verify hook orchestration, not cryptographic or network correctness. Context-hook tests exercise consumers; they do not substitute for provider integration tests.
