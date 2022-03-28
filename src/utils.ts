import moment from 'moment';
import {InvoicePositions, InvoicePrice} from './interfaces';
import { RedisClientType } from 'redis';


export const marshallProtobufAny = (msg: any): any => {
  return {
    type_url: 'room_management.rendering.renderRequest',
    value: Buffer.from(JSON.stringify(msg))
  };
};

export const unmarshallProtobufAny = (msg: any): any => {
  return JSON.parse(msg.value.toString());
};

export const getPreviousMonth = (): moment.Moment => {
  return moment().subtract(1, 'months');
};

export const calcPrice = (price: number, tax: any): InvoicePrice => {
  return {
    gross: price,
    net: price * (1 - tax.rate)
  };
};

export const addPrice = (currentPrice: InvoicePrice, price: number,
  tax: any): InvoicePrice => {
  const toAdd = calcPrice(price, tax);
  return {
    gross: currentPrice.gross + toAdd.gross,
    net: currentPrice.net + toAdd.net
  };
};

export const requestID = (email: string, invoiceNumber: number,
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
        // extract msg Invoice positions and add to existing
        for (let eachInvoicePos of msg.invoice_positions) {
          listOfExistingInvoicePositions.push(eachInvoicePos);
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
