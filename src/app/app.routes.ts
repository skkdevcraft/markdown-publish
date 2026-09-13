import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router, Routes } from '@angular/router';
import { ContentService } from './content/content.service';
import { RouteDispatch } from './views/route-dispatch';
import { GraphView } from './graph/graph-view';
import { TagsView } from './views/tags-view';
import { SearchView } from './views/search-view';

const redirectToHome: CanActivateFn = async () => {
  const content = inject(ContentService);
  const router = inject(Router);
  const manifest = await content.loadManifest();
  return new RedirectCommand(router.parseUrl('/' + manifest.site.homeSlug));
};

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [redirectToHome],
    children: [],
  },
  {
    path: 'graph',
    component: GraphView,
  },
  {
    // pathMatch: 'full' is load-bearing: with Angular's default prefix
    // matching a plain `tags` route would swallow every `tags/<tag>` quiz URL
    // (they'd render this index instead of the deck). Exact match keeps
    // `tags/quiz`-style URLs flowing to the catch-all → RouteDispatch.
    path: 'tags',
    pathMatch: 'full',
    component: TagsView,
  },
  {
    // Dedicated search page. Exact match (like `tags`) so a note slug that
    // merely starts with `search` still falls through to the catch-all.
    path: 'search',
    pathMatch: 'full',
    component: SearchView,
  },
  {
    path: '**',
    component: RouteDispatch,
  },
];
