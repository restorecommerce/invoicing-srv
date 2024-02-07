import moment from 'moment';
import { InvoicePositions, InvoicePrice } from './interfaces.js';
import { RedisClientType } from 'redis';


export const marshallProtobufAny = (msg: any): any => {
  return {
    type_url: 'room_management.rendering.renderRequest',
    value: Buffer.from(JSON.stringify(msg))
  };
};

export const unmarshallProtobufAny = (msg: any): any => {
  const unmarshalledMsg = msg && msg.value ? JSON.parse(msg.value.toString()) : {};
  return unmarshalledMsg;
};

export const getPreviousMonth = (): moment.Moment => {
  return moment().subtract(1, 'months');
};

export const calcPrice = (netPrice: number, tax: any): InvoicePrice => {
  return {
    // tax is decimal number 0 - 1
    gross: netPrice + (netPrice * (tax.rate)),
    net: netPrice
  };
};

export const addPrice = (currentPrice: InvoicePrice, netPrice: number,
  tax: any): InvoicePrice => {
  const toAdd = calcPrice(netPrice, tax);
  return {
    gross: currentPrice.gross + toAdd.gross,
    net: currentPrice.net + toAdd.net
  };
};

export const requestID = (email: string, invoiceNumber: string,
  org_userID: string): string => {
  return `${email}###${invoiceNumber}###${org_userID}`;
};

export const storeInvoicePositions = async (redisInvoicePosClient: RedisClientType<any, any>,
  id: string, msg: InvoicePositions, logger: any): Promise<void> => {
  // unmarshall payment method details data
  if (msg && msg.payment_method_details && msg.payment_method_details.value) {
    msg.payment_method_details =
      unmarshallProtobufAny(msg.payment_method_details);
  }
  const existingInvoicePositions = await redisInvoicePosClient.get(id);
  if (existingInvoicePositions) {
    let invoicePositionsObj = JSON.parse(existingInvoicePositions.toString());
    const listOfExistingInvoicePositions = invoicePositionsObj.invoice_positions;
    if (listOfExistingInvoicePositions &&
      listOfExistingInvoicePositions.length > 0) {
      if (msg && msg.invoice_positions) {
        try {
          // extract msg Invoice positions and add to existing
          for (let eachInvoicePos of msg.invoice_positions) {
            eachInvoicePos.invoiceRows.forEach(e => listOfExistingInvoicePositions[0].invoiceRows.push(e));
            // listOfExistingInvoicePositions[0].invoiceRows.push(...eachInvoicePos.invoiceRows);
            const newItems = eachInvoicePos.invoiceRows;
            // For each item in invoiceRows based on vat and amount, caclulate and and gross and net
            newItems.forEach((item) => {
              const netPrice = item.amount;
              let tax: any = 0;
              if (item.vat && item.vat.endsWith('%')) tax = Number(item.vat.substring(0, item.vat.length - 1));
              if (tax) {
                tax = { rate: tax / 100 };
              }
              listOfExistingInvoicePositions[0].totalPrice = addPrice(listOfExistingInvoicePositions[0].totalPrice, netPrice, tax);
            });
          }
        } catch (err) {
          logger.error('Error processing invoice position', { err, msg });
        }
      }
    } else {
      invoicePositionsObj = msg;
    }
    // updated invoice positions
    await redisInvoicePosClient.set(id, JSON.stringify(invoicePositionsObj));
    logger.info(
      `Invoice positions with ID ${msg.id} has been stored to redis successfully`);
  } else {
    // First message
    await redisInvoicePosClient.set(id, JSON.stringify(msg));
    logger.info(
      `Invoice positions with ID ${msg.id} has been stored to redis successfully`);
  }
};

export const getJSONPaths = (object: any, prefix: string,
  pathsList: Array<string>): any => {
  if (!pathsList) {
    pathsList = [];
  }
  prefix = prefix || '';
  switch (typeof object) {
    case 'object':
      let output = '';
      for (let k in object) {
        if (object.hasOwnProperty(k)) {
          if (prefix === '') {
            output += getJSONPaths(object[k], k, pathsList);
          } else {
            output += getJSONPaths(object[k], prefix + '.' + k, pathsList);
          }
        }
      }
      return output;
    default:
      pathsList.push(prefix + '=' + object);
      return prefix + '=' + object;
  }
};
