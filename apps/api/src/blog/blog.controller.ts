import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { BlogService, BlogInput } from './blog.service';

@Controller()
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  // ── Public (marketing site) ──────────────────────────────
  @Public()
  @Get('blog/public')
  publicList() {
    return this.blog.publicList();
  }

  @Public()
  @Get('blog/public/:slug')
  publicBySlug(@Param('slug') slug: string) {
    return this.blog.publicBySlug(slug);
  }

  @Public()
  @HttpCode(200)
  @Post('blog/public/:slug/like')
  like(@Param('slug') slug: string) {
    return this.blog.like(slug);
  }

  // ── Admin (super + sub admin) ────────────────────────────
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Get('blog')
  list(@CurrentUser() user: AuthUser) {
    return this.blog.listAdmin(user);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Get('blog/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blog.getAdmin(user, id);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Post('blog')
  create(@CurrentUser() user: AuthUser, @Body() dto: BlogInput) {
    return this.blog.create(user, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Patch('blog/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: BlogInput) {
    return this.blog.update(user, id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Delete('blog/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blog.remove(user, id);
  }
}
