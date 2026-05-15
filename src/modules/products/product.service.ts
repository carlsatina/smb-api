import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { ingredientRepository } from '../ingredients/ingredient.repository';
import { recipeRepository } from '../recipes/recipe.repository';
import { productRepository } from './product.repository';

type ProductWithRecipeCount = Prisma.ProductGetPayload<{
    include: {
        recipe: {
            select: {
                deletedAt: true;
                _count: {
                    select: {
                        lines: true;
                    };
                };
            };
        };
    };
}>;

type ProductCreateData = Omit<Prisma.ProductCreateInput, 'store'>;

const withRecipeLineCount = (product: ProductWithRecipeCount) => {
    const { recipe, ...rest } = product;
    const hasRecipe = recipe && !recipe.deletedAt;
    return {
        ...rest,
        recipeLineCount: hasRecipe ? recipe?._count?.lines ?? 0 : 0,
    };
};

type RecipeLineInput = {
    ingredientId: string;
    qtyPerProductUnit: number;
};

const ensureRecipeLinesAllowed = ({
    nextType,
    recipeLines,
}: {
    nextType: Prisma.ProductCreateInput['type'];
    recipeLines?: RecipeLineInput[];
}) => {
    if (nextType !== 'RECIPE' && recipeLines && recipeLines.length > 0) {
        throw new AppError('INVALID_PRODUCT_TYPE', 'Recipe lines can only be used for recipe products.', 400);
    }
};

const validateRecipeLines = async (storeId: string, recipeLines: RecipeLineInput[]) => {
    if (recipeLines.length === 0) {
        return;
    }

    const ingredientIds = recipeLines.map((line) => line.ingredientId);
    const uniqueIngredientIds = Array.from(new Set(ingredientIds));

    if (uniqueIngredientIds.length !== ingredientIds.length) {
        throw new AppError('DUPLICATE_INGREDIENT', 'Each ingredient can only appear once in a recipe.', 400);
    }

    const count = await ingredientRepository.countByIds(storeId, uniqueIngredientIds);
    if (count !== uniqueIngredientIds.length) {
        throw new AppError('INGREDIENT_NOT_FOUND', 'One or more ingredients are missing.', 404);
    }
};

const resolveRecipeLineCount = async ({
    storeId,
    productId,
    recipeLines,
}: {
    storeId: string;
    productId?: string;
    recipeLines?: RecipeLineInput[];
}) => {
    if (recipeLines) {
        return recipeLines.length;
    }
    if (productId) {
        return productRepository.countRecipeLinesByProductId(storeId, productId);
    }
    return 0;
};

const ensureRecipeActivationAllowed = async ({
    storeId,
    productId,
    nextType,
    nextActive,
    recipeLines,
}: {
    storeId: string;
    productId?: string;
    nextType: Prisma.ProductCreateInput['type'];
    nextActive: boolean;
    recipeLines?: RecipeLineInput[];
}) => {
    if (nextType !== 'RECIPE' || !nextActive) {
        return;
    }

    const lineCount = await resolveRecipeLineCount({ storeId, productId, recipeLines });
    if (lineCount === 0) {
        throw new AppError(
            'RECIPE_LINES_REQUIRED',
            'Recipe products must have at least one recipe line before activation.',
            400
        );
    }
};

export const productService = {
    list: async (storeId: string) => {
        const products = await productRepository.listByStore(storeId);
        return products.map((product) => withRecipeLineCount(product));
    },
    get: async (storeId: string, productId: string) => {
        const product = await productRepository.getById(storeId, productId);
        if (!product) {
            throw new AppError('NOT_FOUND', 'Product not found', 404);
        }
        return withRecipeLineCount(product);
    },
    create: async (storeId: string, data: ProductCreateData, recipeLines?: RecipeLineInput[]) => {
        try {
            const nextActive = data.active ?? (data.type === 'RECIPE' ? false : true);
            ensureRecipeLinesAllowed({ nextType: data.type, recipeLines });
            if (recipeLines) {
                await validateRecipeLines(storeId, recipeLines);
            }
            await ensureRecipeActivationAllowed({
                storeId,
                nextType: data.type,
                nextActive,
                recipeLines,
            });

            if (data.type === 'RECIPE' && recipeLines) {
                const productId = await prisma.$transaction(async (tx) => {
                    const created = await tx.product.create({
                        data: {
                            ...data,
                            active: nextActive,
                            store: { connect: { id: storeId } },
                        },
                    });

                    const formattedLines = recipeLines.map((line) => ({
                        ingredientId: line.ingredientId,
                        qtyPerProductUnit: new Prisma.Decimal(line.qtyPerProductUnit),
                    }));

                    const recipe = await recipeRepository.upsertRecipe(storeId, created.id, tx);
                    await recipeRepository.createLines(recipe.id, formattedLines, tx);
                    return created.id;
                });

                const created = await productRepository.getById(storeId, productId);
                if (!created) {
                    throw new AppError('NOT_FOUND', 'Product not found', 404);
                }
                return withRecipeLineCount(created);
            }

            const created = await productRepository.create(storeId, {
                ...data,
                active: nextActive,
            });
            return withRecipeLineCount(created);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new AppError('DUPLICATE', 'Product with same SKU or barcode already exists', 409);
            }
            throw error;
        }
    },
    update: async (
        storeId: string,
        productId: string,
        data: Prisma.ProductUpdateInput,
        recipeLines?: RecipeLineInput[]
    ) => {
        try {
            const existing = await productRepository.getById(storeId, productId);
            if (!existing) {
                throw new AppError('NOT_FOUND', 'Product not found', 404);
            }

            const nextType = (data.type ?? existing.type) as Prisma.ProductCreateInput['type'];
            const nextActive =
                typeof data.active === 'boolean' ? data.active : (existing.active as boolean);

            ensureRecipeLinesAllowed({ nextType, recipeLines });
            if (recipeLines) {
                await validateRecipeLines(storeId, recipeLines);
            }
            await ensureRecipeActivationAllowed({
                storeId,
                productId,
                nextType,
                nextActive,
                recipeLines,
            });

            if (nextType === 'RECIPE' && recipeLines) {
                await prisma.$transaction(async (tx) => {
                    const updateResult = await tx.product.updateMany({
                        where: {
                            id: productId,
                            storeId,
                            deletedAt: null,
                        },
                        data: data as Prisma.ProductUncheckedUpdateManyInput,
                    });

                    if (updateResult.count === 0) {
                        throw new AppError('NOT_FOUND', 'Product not found', 404);
                    }

                    const formattedLines = recipeLines.map((line) => ({
                        ingredientId: line.ingredientId,
                        qtyPerProductUnit: new Prisma.Decimal(line.qtyPerProductUnit),
                    }));

                    const recipe = await recipeRepository.upsertRecipe(storeId, productId, tx);
                    await recipeRepository.deleteLines(recipe.id, tx);
                    await recipeRepository.createLines(recipe.id, formattedLines, tx);
                });

                const updated = await productRepository.getById(storeId, productId);
                if (!updated) {
                    throw new AppError('NOT_FOUND', 'Product not found', 404);
                }
                return withRecipeLineCount(updated);
            }

            const updated = await productRepository.update(storeId, productId, data);
            if (!updated) {
                throw new AppError('NOT_FOUND', 'Product not found', 404);
            }
            return withRecipeLineCount(updated);
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new AppError('DUPLICATE', 'Product with same SKU or barcode already exists', 409);
            }
            throw error;
        }
    },
    remove: async (storeId: string, productId: string) => {
        const deleted = await productRepository.softDelete(storeId, productId);
        if (!deleted) {
            throw new AppError('NOT_FOUND', 'Product not found', 404);
        }
    },
};
