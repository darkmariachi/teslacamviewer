import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Favorite } from 'src/app/models/Favorite';

@Injectable({
  providedIn: 'root'
})
export class FavoritesService {

  private readonly apiEndpoint = 'api/Favorites';
  constructor(private httpClient: HttpClient) { }

  getFavorites(): Observable<Favorite[]> {
    return this.httpClient.get<Favorite[]>(this.apiEndpoint);
  }

  toggleFavorite(favorite: Favorite): Observable<void> {
    return this.httpClient.post<void>(this.apiEndpoint, favorite);
  }


}
