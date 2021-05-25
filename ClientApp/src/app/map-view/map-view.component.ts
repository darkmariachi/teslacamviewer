import { AfterViewInit, Component, Input, OnInit } from '@angular/core';
import { TeslaEvent } from '../models/TeslaEvent';
import Map from 'ol/Map';
import { View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
declare var ol: any;

@Component({
  selector: 'map-view',
  templateUrl: './map-view.component.html',
  styleUrls: ['./map-view.component.css']
})

export class MapViewComponent implements OnInit, AfterViewInit {

  @Input() teslaEvent: TeslaEvent;
  @Input() id: string;

  map: any;
  

  constructor() { }


  ngOnInit() {
    
  }

  ngAfterViewInit() {
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
        zoom: 16
      }),
    });
  }

}
