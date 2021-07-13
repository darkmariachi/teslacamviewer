import { Component, OnInit } from '@angular/core';
import { Favorite } from '../models/Favorite';
import { FavoritesService } from '../services/favorites/favorites.service';

@Component({
  selector: 'app-favorites',
  templateUrl: './favorites.component.html',
  styleUrls: ['./favorites.component.css']
})
export class FavoritesComponent implements OnInit {

  teslaFolders = [];
  search = '';
  constructor(private favoritesService: FavoritesService) { }

  ngOnInit() {
    this.favoritesService.getFavoriteFolders()
    .subscribe(res => {
      this.teslaFolders = res;
    });
  }

  toggleFavorite(name: string, type:string) {
    this.favoritesService.toggleFavorite({ name: name, type: type } as Favorite)
    .subscribe(() => {
      if (type === 'Folder') {
        const folderToUnfav = this.teslaFolders.find(f => f.name === name);
        this.teslaFolders.splice(this.teslaFolders.indexOf(folderToUnfav), 1);
      }
    });
  }

}
