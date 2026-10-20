# ZUGFeRD invoice export and testing

The existing Render API handles the optional `export_format` selection. In the
TypeScript client, the property is `exportFormat`. Every added protobuf field
is optional; additional data checks apply when an e-invoice export is selected.

For each invoice, the library is called once. For BOTH, the service extracts the
attachment bytes from that generated PDF and stores them separately; it does
not regenerate or reserialize the XML.

The target is **ZUGFeRD EN16931**. The library accepts an internal JSON structure
based on UBL and converts it to CII XML. The XML uses the guideline identifier
`urn:cen.eu:en16931:2017`; it is not an XRechnung export.

## Request, response and storage

Using an existing TypeScript gRPC client and a complete invoice:

```ts
import { InvoiceExportFormat } from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/invoice.js';

const response = await client.render({
  items: [invoice],
  subject,
  exportFormat: InvoiceExportFormat.ZUGFERD_BOTH,
});
```

A successful item has status 200 and its `payload.documents` contains descriptors for the stored
files: URL, filename, byte count and `application/pdf` or `application/xml`.
Existing document history is retained. Both new files use the same export
directory and distinct document IDs, in the existing configured invoice bucket.
The invoice is saved and its rendered event emitted after the requested files
have been stored.

Missing or inconsistent invoice data, and the library's input-schema/code-list
failures, return item status 400 with a message identifying the problem. A
response containing failed items has operation status 207, as the existing batch
API does. 

These API checks do not run a full external EN16931/PDF/A validator on every
request. The independent validation steps below check the generated files.

## Data sources

The mapper takes the invoice plus the service's already aggregated related
records. Invoice numbers must have been assigned and sender/billing/recipient
addresses populated before calling it. It does not fetch or modify records.

No date, unit code, tax identifier or exemption explanation is fabricated.
Positive amounts due require either payment terms or a due date. Seller tax
identification and exemption explanations depend on the VAT category. The
library checks valid unit/country/currency/category codes when generating XML.
The relevant [EN16931 payment rule](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-CO-25/),
[seller tax identification rule](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-S-02/)
and [quantity unit rule](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-23/)
explain these requirements. Additional XRechnung-specific fields are not imposed.

Independent validation remains necessary for the
full set of EN16931 business rules; see the [library validation documentation](https://gflohr.github.io/e-invoice-eu/en/docs/details/validation/).

## Run the offline tests

From the invoicing-srv repository root with Node 26 selected:

```sh
NODE_ENV=test npm run --ignore-scripts test -- test/e-invoice.spec.ts test/invoice-export-request.spec.ts test/invoice-export.spec.ts --coverage.enabled=false
```

The fixture in `test/fixtures/e-invoice.ts` is separate from the existing minimal
PDF test fixture. It contains fictional companies, complete addresses, an issue
date, a due date, VAT IDs and a unit code. Its amounts match the corrected
existing fixture: net EUR 8.99, VAT EUR 1.71, gross EUR 10.70.

## Get real API outputs for human testing

1. Select Node 26 and start the Docker backing system repo services.
2. From the invoicing-srv root, run:

   ```sh
   NODE_ENV=test npm run --ignore-scripts test -- test/invoicing-srv.spec.ts --coverage.enabled=false -t 'should start|should create|invoice create event|should render|invoice render event|ZUGFeRD export'
   ```
3. Open `output/e-invoice/api/zugferd_both.pdf` in a PDF viewer. It was downloaded
   from object storage by the test, so no RustFS-console steps are needed.
4. Inspect `output/e-invoice/api/zugferd_both.xml`. In a PDF viewer with an attachments panel, check
   that the PDF contains `factur-x.xml`.
5. Compare the separate and extracted attachment files:

   ```sh
   cmp output/e-invoice/api/zugferd_both.xml output/e-invoice/api/zugferd_both.embedded.xml
   ```

   Success means no output and exit code 0. The test already checks this equality.
6. Validate the XML and PDF using the commands in the next section for PDF/A compliance.

## Automated visible PDF/XML consistency checks

Run just the two multi-line consistency tests, with the same local services:

```sh
NODE_ENV=test npm run --ignore-scripts test -- test/invoicing-srv.spec.ts --coverage.enabled=false -t 'ZUGFeRD export compares visible PDF'
```

## Validate the actual API XML and PDF independently

Java and [Mustang CLI](https://github.com/ZUGFeRD/mustangproject/releases/tag/core-2.26.0)
are needed for independent validation. Sadly no full NodeJS solutions. Export generation uses npm packages with
our existing PDF renderer.

### One-time tool setup on Linux x64

From the repository root, download a portable Java 21 runtime and Mustang 2.26.0
into `output/validation-tools`. This directory is ignored by Git.

```sh
mkdir -p output/validation-tools/java-runtime
curl -fL --retry 3 https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.26.0/Mustang-CLI-2.26.0.jar -o output/validation-tools/Mustang-CLI-2.26.0.jar
curl -fL --retry 3 https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz -o output/validation-tools/java21-jre.tar.gz

cat > output/validation-tools/SHA256SUMS <<'EOF'
42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736  output/validation-tools/Mustang-CLI-2.26.0.jar
2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500  output/validation-tools/java21-jre.tar.gz
EOF
sha256sum -c output/validation-tools/SHA256SUMS &&
tar -xzf output/validation-tools/java21-jre.tar.gz --strip-components=1 -C output/validation-tools/java-runtime
```

Both checksum checks must report `OK` before extraction. 

### Run validation

In each new terminal, from the repository root, set these variables:

```sh
export INVOICE_JAVA="$PWD/output/validation-tools/java-runtime/bin/java"
export INVOICE_MUSTANG="$PWD/output/validation-tools/Mustang-CLI-2.26.0.jar"

"$INVOICE_JAVA" -version
"$INVOICE_JAVA" -Xmx512m -jar "$INVOICE_MUSTANG" --action validate --source output/e-invoice/api/zugferd_both.xml --disable-file-logging > output/e-invoice/api/zugferd_both.xml.validation.xml 2> output/e-invoice/api/zugferd_both.xml.validation.log
"$INVOICE_JAVA" -Xmx512m -jar "$INVOICE_MUSTANG" --action validate --source output/e-invoice/api/zugferd_both.pdf --disable-file-logging > output/e-invoice/api/zugferd_both.pdf.validation.xml 2> output/e-invoice/api/zugferd_both.pdf.validation.log
```

The `.validation.xml` files contain the validation results; the `.validation.log` files contain diagnostic messages.

After each command, require exit code 0. Open the reports and check:

- The final `summary status="valid"` in both reports.
- XML profile `urn:cen.eu:en16931:2017`, with no errors or warnings.
- In the PDF report, `flavour=3b`, `isCompliant=true` and the PDF summary `valid`.
  Mustang runs the PDF/A validation in addition to validating the embedded XML.

```
[main] WARN com.helger.xml.transform.LoggingTransformErrorListener - [warn] Transformation warning (net.sf.saxon.trans.XPathException: A function that computes atomic values should use xsl:sequence rather than xsl:value-of)
[main] WARN com.helger.xml.transform.LoggingTransformErrorListener - [warn] Transformation warning (net.sf.saxon.trans.XPathException: A function that computes atomic values should use xsl:sequence rather than xsl:value-of)
```

The warnings above can be ignored. They concern how Mustang’s bundled validation stylesheet is written, rather than an error in our invoice..

## Generate XML for inspection

```sh
NODE_ENV=test node test/generate-invoice-xml.mjs
```

Open `output/e-invoice/fixture-invoice.xml` in a text editor. This script runs the
actual new mapper and library with the complete fixture. It does not call Render
or create a PDF. 

## Validate the XML independently

```sh
"$INVOICE_JAVA" -Xmx512m -jar "$INVOICE_MUSTANG" --action validate --source output/e-invoice/fixture-invoice.xml --disable-file-logging > output/e-invoice/fixture-invoice.validation.xml 2> output/e-invoice/fixture-invoice.validation.log
```

Check the command's exit code and the report's final `summary status="valid"`.
Review error, warning and notice messages as well. 
