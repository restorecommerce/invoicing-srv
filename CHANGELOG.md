## 0.3.2 (July 8th, 2022)

- updated dependencies

## 0.3.1 (July 7th, 2022)

- updated dependencies

## 0.3.0 (June 30th, 2022)

- updated dependencies

## 0.2.8 (April 20th, 2022)

- fix price calculation and added configurable due date for invoice
- added generateInvoiceNumber api and support for downloading additional invoice attachments
- added value performance dates for invoice
- bcc email configuration for invoice notification

## 0.2.7 (April 7th, 2022)

- fix invoice price calculation, updated invoice proto
- included locality and billing recipient org name in invoice

## 0.2.6 (March 29th, 2022)

- redis client updated get operation and added typings
- up tsconfig and import statements
- fixed price calculation and improved logging
- up dependencies

## 0.2.5 (March 1st, 2022)

- fixed logger

## 0.2.4 (February 18th, 2022)

- updated chassis-srv (includes fix for offset store config)

## 0.2.3 (February 15th, 2022)

- up all dependencies

## 0.2.2 (September 21st, 2021)

- up RC dependencies

## 0.2.1 (September 13th, 2021)

- up dependencies

## 0.2.0 (August 27th, 2021)

- latest grpc-client
- migraged kafka-client to kafkajs
- chassis-srv using the latest grpc-js and protobufdef loader
- filter changes (removed google.protobuf.struct completely and defined nested proto structure)
- added status object to each item and also overall operation_status

# 0.0.12

- Updated dependencies

# 0.0.11

- Updated dependencies

# 0.0.10

- Update dependencies, enable data stream based logging by default
- update deps and docker files

# 0.0.9

- Updated dependencies
- Changes for payment method details
- Added email templates

# 0.0.8

- Updated dependencies

# 0.0.7

- Public release

# 0.0.6

-  fix for changes in ostorage-srv to add options for file upload operation

# 0.0.5

- fix for changes in payment method proto

# 0.0.4

- up protos
- added healthcheck
- changes for HBS template URL configurations

# 0.0.3

- changes to handle merger of telephone number changes and updated invoice proto

# 0.0.2

- changes to retreive org or userID associated to use it for scoping when storing
  the invoice to ostorage

# 0.0.1

- Initial push
