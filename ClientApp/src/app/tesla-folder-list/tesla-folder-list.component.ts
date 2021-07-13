import { Component, OnInit } from '@angular/core';
import { Observable, of } from 'rxjs';
import { TeslaFolder } from '../models/TeslaFolder';
import { TeslaFolderService } from '../services/tesla-folder.service';
import { catchError } from 'rxjs/operators';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { FavoritesService } from '../services/favorites/favorites.service';
import { Favorite } from '../models/Favorite';

@Component({
  selector: 'app-tesla-folder-list',
  templateUrl: './tesla-folder-list.component.html',
  styleUrls: ['./tesla-folder-list.component.css']
})
export class TeslaFolderListComponent implements OnInit {

  teslaFolders$: Observable<TeslaFolder[]>;
  error:string;
  search = "";
  orderByProperty = "name";
  favorites = [];

  constructor(
    private teslaFolderService: TeslaFolderService,
    private modalService: NgbModal,
    private favoritesService: FavoritesService) { }

  ngOnInit() {
    this.getFolders();
    this.getFavorites();
  }

  changeOrderBy(property: string) {
    if (this.isOrderedByProperty(property)) {
      if (!this.isReversedOrdered()) {
        this.orderByProperty = `-${property}`;
        return;
      }
    } 
    this.orderByProperty = property
  }

  isOrderedByProperty(property: string) {
    return this.orderByProperty.indexOf(property) !== -1;
  }

  isReversedOrdered() {
    return this.orderByProperty.indexOf("-") !== -1;
  }

  delete(tf: TeslaFolder) {
    const modalRef = this.modalService.open(ConfirmationModalComponent);
    modalRef.componentInstance.title = 'Confirm Deletion';
    modalRef.componentInstance.text = `Are you sure you want to delete the folder ${tf.name} for the date ${tf.teslaEvent.timeStamp}.
       Please notice, deletion is PERMANENT.`;
    modalRef.result.then((res) => {
      if (res) {
            this.teslaFolderService.deleteTeslaFolder(tf)
            .subscribe(() => {
              this.getFolders();
            });
      }
    }).catch(() => {

    });
  }

  getColorIfFavorite(tf : TeslaFolder) {
    return this.favorites.find((f: Favorite) => f.name == tf.name && f.type == 'Folder') ? 'red': 'black';
  }

  toggleFavorite(tf: TeslaFolder) {
    const newFav = { name: tf.name,  type: 'Folder'} as Favorite
    this.favoritesService.toggleFavorite(newFav)
    .subscribe(() => {
      this.addOrRemoveFavorite(newFav);
    });
  }

  private getFolders() {
    this.teslaFolders$ = this.teslaFolderService.getTeslaFolders()
    .pipe(catchError((err) => {
      this.error = err.error;
      return of;
    }));
  }

  private getFavorites() {
    this.favoritesService.getFavorites()
    .subscribe(favs => {
      this.favorites = favs;
    })
  }

  private addOrRemoveFavorite(favorite: Favorite) {
    const fav = this.favorites.find(f => f.name == favorite.name && f.type == favorite.type);
    if (!fav) {
      this.favorites.push(favorite);
    } else {
      this.favorites.splice(this.favorites.indexOf(fav), 1);
    }
  }

}
