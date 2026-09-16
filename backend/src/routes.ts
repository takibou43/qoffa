import { Router } from 'express';
import { addressesRouter } from './modules/addresses/addresses.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { driversRouter } from './modules/drivers/drivers.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { shopsRouter } from './modules/shops/shops.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/shops', shopsRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/addresses', addressesRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/drivers', driversRouter);
