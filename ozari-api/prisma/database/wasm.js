
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 6.5.0
 * Query Engine version: 173f8d54f8d52e692c7e27e72a88314ec7aeff60
 */
Prisma.prismaVersion = {
  client: "6.5.0",
  engine: "173f8d54f8d52e692c7e27e72a88314ec7aeff60"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.UserRoleScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  fullNameKms: 'fullNameKms',
  emailSha: 'emailSha',
  emailKms: 'emailKms',
  roleId: 'roleId',
  passwordSha: 'passwordSha',
  passwordKms: 'passwordKms',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.BlacklistTypeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.BlacklistScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  blacklistTypeId: 'blacklistTypeId',
  reason: 'reason',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.UserPhoneTypeScalarFieldEnum = {
  id: 'id',
  type: 'type',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.UserPhoneScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  userPhoneTypeId: 'userPhoneTypeId',
  phoneNumberKms: 'phoneNumberKms',
  isPrincipal: 'isPrincipal',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.CurrencyScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  symbol: 'symbol',
  iso4217Code: 'iso4217Code',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ProductBusinessTypeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ProductCategoryScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ProductScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  imageUrl: 'imageUrl',
  productBusinessTypeId: 'productBusinessTypeId',
  productCategoryId: 'productCategoryId',
  rentPrice: 'rentPrice',
  sellPrice: 'sellPrice',
  currencyId: 'currencyId',
  quantity: 'quantity',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ProductDetailTypeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ProductDetailScalarFieldEnum = {
  id: 'id',
  productId: 'productId',
  productDetailTypeId: 'productDetailTypeId',
  detail: 'detail',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.CountryScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.CountryDepartmentScalarFieldEnum = {
  id: 'id',
  name: 'name',
  countryId: 'countryId',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.MunicipalityScalarFieldEnum = {
  id: 'id',
  name: 'name',
  departmentId: 'departmentId',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ZoneScalarFieldEnum = {
  id: 'id',
  name: 'name',
  municipalityId: 'municipalityId',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.AddressScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  zoneId: 'zoneId',
  addressKms: 'addressKms',
  coordsKms: 'coordsKms',
  instructionsKms: 'instructionsKms',
  domicilePrice: 'domicilePrice',
  deliveryTimeMinutes: 'deliveryTimeMinutes',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ServiceStatusScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.PaymentStatusScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ServiceScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  deliveryNameKms: 'deliveryNameKms',
  addressId: 'addressId',
  userPhoneId: 'userPhoneId',
  description: 'description',
  serviceStart: 'serviceStart',
  serviceEnd: 'serviceEnd',
  totalAmount: 'totalAmount',
  currencyId: 'currencyId',
  serviceStatusId: 'serviceStatusId',
  paymentStatusId: 'paymentStatusId',
  comment: 'comment',
  invoiceNumberKms: 'invoiceNumberKms',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ServiceDetailScalarFieldEnum = {
  id: 'id',
  serviceId: 'serviceId',
  productId: 'productId',
  quantity: 'quantity',
  unitaryPrice: 'unitaryPrice',
  parcialPrice: 'parcialPrice',
  currencyId: 'currencyId',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ServiceExtraScalarFieldEnum = {
  id: 'id',
  serviceId: 'serviceId',
  name: 'name',
  description: 'description',
  quantity: 'quantity',
  unitaryPrice: 'unitaryPrice',
  parcialPrice: 'parcialPrice',
  currencyId: 'currencyId',
  isActive: 'isActive',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  UserRole: 'UserRole',
  User: 'User',
  BlacklistType: 'BlacklistType',
  Blacklist: 'Blacklist',
  UserPhoneType: 'UserPhoneType',
  UserPhone: 'UserPhone',
  Currency: 'Currency',
  ProductBusinessType: 'ProductBusinessType',
  ProductCategory: 'ProductCategory',
  Product: 'Product',
  ProductDetailType: 'ProductDetailType',
  ProductDetail: 'ProductDetail',
  Country: 'Country',
  CountryDepartment: 'CountryDepartment',
  Municipality: 'Municipality',
  Zone: 'Zone',
  Address: 'Address',
  ServiceStatus: 'ServiceStatus',
  PaymentStatus: 'PaymentStatus',
  Service: 'Service',
  ServiceDetail: 'ServiceDetail',
  ServiceExtra: 'ServiceExtra'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
