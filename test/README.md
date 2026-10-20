# Running the existing tests and retrieving an invoice PDF

## 1. Select Node 26 and install dependencies

From the repository root, using nvm:

```sh
nvm install
nvm use
node --version
npm ci
```

```sh
NODE_ENV=test npm run --ignore-scripts test -- test/invoice-export-request.spec.ts --coverage.enabled=false
```

These six checks cover existing request compatibility, transmission of all
four export selections and the optional e-invoice fields.

Render now processes the export selections. See [E_INVOICE.md](E_INVOICE.md)
for steps to download actual API-generated XML/hybrid PDFs automatically and validate XML and PDF/A compliance.

## 2. Start the Docker backing system repo services

## 3. Run all tests, including e-invoice tests

From the invoicing-srv repository root:

```sh
NODE_ENV=test npm run --ignore-scripts test
```

`--ignore-scripts` skips the `pretest` hook, which runs ESLint with `--fix` and
can rewrite source files. The test command itself still runs normally. To run
the package's original test command including that hook:

```sh
NODE_ENV=test npm test
```

The full suite includes the `send` API test and uses the configured notification
service. Its cleanup deletes the invoice collection in `invoicing-srv-test`.
Keep `NODE_ENV=test` and run against a disposable local test environment.

## 4. Run the existing create/render tests to get a PDF

This runs five existing checks and skips send, withdraw and the explicit delete
test. The shared cleanup still deletes the test invoice collection. The stored
PDF remains in object storage after cleanup.

```sh
set -o pipefail
NODE_ENV=test npm run --ignore-scripts test -- test/invoicing-srv.spec.ts --coverage.enabled=false -t 'should start|should create|invoice create event|should render|invoice render event' 2>&1 | tee /tmp/invoicing-render-tests.log
```

Find the PDF object reference in the log:

```sh
rg -o '//invoices/[^" ]+\.pdf' /tmp/invoicing-render-tests.log | sort -u
```

For example:

```text
//invoices/shop_1/validInvoice_1/65a989053a694879a6323017d54582f3/test-0000000001.pdf
```

## 5. Download and inspect the stored PDF

1. Open <http://localhost:9001>, the local RustFS console.
2. Sign in using the `RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY` values from the
   `rustfs.environment` section of `../system/docker/restoreservices-docker-compose.yml`.
3. Open the `invoices` bucket.
4. Navigate to `shop_1` / `validInvoice_1` / the document directory printed in
   step 4. If the console shows a flat object list, search for that object key.
5. Select the `test-....pdf` object and download it.
6. Open the downloaded file in your PDF viewer.
