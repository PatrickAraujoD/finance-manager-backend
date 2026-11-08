import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateCategory } from '../../../application/use-cases/categories/create-category';
import { DeleteCategory } from '../../../application/use-cases/categories/delete-category';
import { ListCategories } from '../../../application/use-cases/categories/list-categories';
import { UpdateCategory } from '../../../application/use-cases/categories/update-category';
import { AuthenticatedUser, CurrentUser } from '../decorators/current-user.decorator';
import { CreateCategoryDto, UpdateCategoryDto } from '../dtos/categories.dto';
import { CategoryView, toCategoryView } from '../views';

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly createCategory: CreateCategory,
    private readonly listCategories: ListCategories,
    private readonly updateCategory: UpdateCategory,
    private readonly deleteCategory: DeleteCategory,
  ) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<CategoryView[]> {
    return (await this.listCategories.execute(actor)).map(toCategoryView);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<{ id: string }> {
    return this.createCategory.execute(actor, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryView> {
    return toCategoryView(await this.updateCategory.execute(actor, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteCategory.execute(actor, id);
  }
}
