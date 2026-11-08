import { Category as CategoryRow, Prisma } from '@prisma/client';
import { MAX_LIST_RESULTS } from '../../application/ports/limits';
import { CategoryRepository } from '../../application/ports/category-repository';
import { Category } from '../../domain/entities/category';
import { ConflictError } from '../../domain/errors';
import { PrismaService } from './prisma.service';

function toDomain(row: CategoryRow): Category {
  return Category.create({ id: row.id, name: row.name, ownerId: row.ownerId });
}

function errorCode(error: unknown): string | null {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(category: Category): Promise<void> {
    const data = {
      name: category.name,
      nameKey: category.nameKey,
      ownerId: category.ownerId,
    };
    try {
      await this.prisma.client.category.upsert({
        where: { id: category.id },
        create: { id: category.id, ...data },
        // The owner never changes: only the name can be edited.
        update: { name: data.name, nameKey: data.nameKey },
      });
    } catch (error) {
      // UNIQUE(ownerId, nameKey) for personal categories, partial unique index for globals.
      if (errorCode(error) === 'P2002') throw new ConflictError('Category name already in use');
      throw error;
    }
  }

  async findById(id: string): Promise<Category | null> {
    const row = await this.prisma.client.category.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async listVisibleTo(userId: string): Promise<Category[]> {
    const rows = await this.prisma.client.category.findMany({
      where: { OR: [{ ownerId: null }, { ownerId: userId }] },
      orderBy: [{ nameKey: 'asc' }, { id: 'asc' }],
      take: MAX_LIST_RESULTS,
    });
    return rows.map(toDomain);
  }

  async countOwnedBy(userId: string): Promise<number> {
    return this.prisma.client.category.count({ where: { ownerId: userId } });
  }

  async delete(id: string): Promise<void> {
    try {
      // deleteMany: deleting a category that is already gone is not an error.
      await this.prisma.client.category.deleteMany({ where: { id } });
    } catch (error) {
      // Expense.categoryId is ON DELETE RESTRICT: the database refuses, expenses stay untouched.
      if (errorCode(error) === 'P2003') throw new ConflictError('Category is in use');
      throw error;
    }
  }

  async isInUse(id: string): Promise<boolean> {
    return (await this.prisma.client.expense.count({ where: { categoryId: id } })) > 0;
  }
}
