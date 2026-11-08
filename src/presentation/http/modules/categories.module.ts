import { Module } from '@nestjs/common';
import { CategoryRepository } from '../../../application/ports/category-repository';
import { IdGenerator } from '../../../application/ports/id-generator';
import { CreateCategory } from '../../../application/use-cases/categories/create-category';
import { DeleteCategory } from '../../../application/use-cases/categories/delete-category';
import { ListCategories } from '../../../application/use-cases/categories/list-categories';
import { UpdateCategory } from '../../../application/use-cases/categories/update-category';
import { CategoriesController } from '../controllers/categories.controller';
import { CATEGORY_REPOSITORY, ID_GENERATOR } from '../tokens';

@Module({
  controllers: [CategoriesController],
  providers: [
    {
      provide: CreateCategory,
      inject: [CATEGORY_REPOSITORY, ID_GENERATOR],
      useFactory: (categories: CategoryRepository, ids: IdGenerator) =>
        new CreateCategory(categories, ids),
    },
    {
      provide: ListCategories,
      inject: [CATEGORY_REPOSITORY],
      useFactory: (categories: CategoryRepository) => new ListCategories(categories),
    },
    {
      provide: UpdateCategory,
      inject: [CATEGORY_REPOSITORY],
      useFactory: (categories: CategoryRepository) => new UpdateCategory(categories),
    },
    {
      provide: DeleteCategory,
      inject: [CATEGORY_REPOSITORY],
      useFactory: (categories: CategoryRepository) => new DeleteCategory(categories),
    },
  ],
})
export class CategoriesModule {}
