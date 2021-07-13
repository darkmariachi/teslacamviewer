import { Component, OnInit } from '@angular/core';
import { FavoritesService } from '../services/favorites/favorites.service';

@Component({
  selector: 'app-favorites',
  templateUrl: './favorites.component.html',
  styleUrls: ['./favorites.component.css']
})
export class FavoritesComponent implements OnInit {

  constructor(private favoritesService: FavoritesService) { }

  ngOnInit() {
    this.favoritesService.getFavoriteFolders()
    .subscribe(res => {
      console.log(res);
    });
  }

}
