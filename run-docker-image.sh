#!/bin/bash
docker run \
 --name restorecommerce_invoicing_srv \
 --hostname invoicing-srv \
 --network=system_restorecommerce \
 -e NODE_ENV=production \
 -p 50051:50051 \
 restorecommerce/invoicing-srv
