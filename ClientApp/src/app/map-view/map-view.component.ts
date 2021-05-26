import { AfterViewInit, ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { TeslaEvent } from '../models/TeslaEvent';
declare var ol: any;

@Component({
  selector: 'map-view',
  templateUrl: './map-view.component.html',
  styleUrls: ['./map-view.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class MapViewComponent implements OnInit, AfterViewInit {

  @Input() teslaEvent: TeslaEvent;
  @Input() id: string;
  @Input() afterInit: boolean;
  @Input() zoom: number;

  map: any;
  

  constructor() { }


  ngAfterViewInit() {
    // if(this.afterInit)
    this.initMap();
  }

  ngOnInit() {
    // this.initMap();
  }

  private initMap() {
    if (document.getElementById(this.id).hasChildNodes()) return;
    this.map = new ol.Map({
      target: this.id,
      layers: [
        new ol.layer.Tile({
          source: new ol.source.OSM()
        }),
        new ol.layer.Vector({ source: new ol.source.Vector({
          features: [
            new ol.Feature({
              geometry: new ol.geom.Point(ol.proj.fromLonLat([this.teslaEvent.est_Lon, this.teslaEvent.est_Lat]))
            })
          ]
        })})
      ],
      view: new ol.View({
        center: ol.proj.fromLonLat([this.teslaEvent.est_Lon, this.teslaEvent.est_Lat]),
        zoom: this.zoom ? this.zoom : 16
      }),
    });
  }

}
