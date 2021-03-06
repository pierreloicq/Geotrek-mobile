import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChange,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { ScreenOrientation } from '@ionic-native/screen-orientation/ngx';
import { GeolocateService } from '@app/services/geolocate/geolocate.service';
import { Platform, ModalController, AlertController } from '@ionic/angular';
import { Feature, GeoJsonProperties, Geometry, Point } from 'geojson';
import {
  GeoJSONSource,
  GeoJSONSourceRaw,
  Map,
  MapboxOptions,
  Marker
} from 'mapbox-gl';
import { Observable } from 'rxjs';
import { SelectTrekComponent } from '@app/components/select-trek/select-trek.component';

import { MinimalTrek, DataSetting, Trek } from '@app/interfaces/interfaces';
import { environment } from '@env/environment';
import { UnSubscribe } from '../abstract/unsubscribe';
import { SettingsService } from '@app/services/settings/settings.service';
import { TranslateService } from '@ngx-translate/core';
import { throttle } from 'lodash';

const mapboxgl = require('mapbox-gl');

@Component({
  selector: 'app-map-treks-viz',
  templateUrl: './map-treks-viz.component.html',
  styleUrls: ['./map-treks-viz.component.scss']
})
export class MapTreksVizComponent extends UnSubscribe
  implements OnChanges, OnDestroy {
  private map: Map;
  private markerPosition: Marker | undefined;
  private practices: DataSetting;

  @ViewChild('mapViz', { static: false }) mapViz: any;

  @Input() public filteredTreks: MinimalTrek[] | null = null;
  @Input() public mapConfig: MapboxOptions;
  @Input() public dataSettings: DataSetting[];
  @Input() public commonSrc: string;
  @Input() public offline: Boolean;

  @Output() public navigateToTrek = new EventEmitter<any>();
  @Output() public mapIsLoaded = new EventEmitter<boolean>();

  constructor(
    private screenOrientation: ScreenOrientation,
    private platform: Platform,
    private geolocate: GeolocateService,
    private modalController: ModalController,
    private settings: SettingsService,
    private alertController: AlertController,
    private translate: TranslateService
  ) {
    super();
    if (environment && environment.mapbox && environment.mapbox.accessToken) {
      mapboxgl.accessToken = environment.mapbox.accessToken;
    }

    this.flyToUserLocation = throttle(this.flyToUserLocation, 3000);
  }

  ngOnChanges(changes: SimpleChanges) {
    const changesCurrentTreks: SimpleChange = changes.filteredTreks;
    if (
      changesCurrentTreks.currentValue &&
      !changesCurrentTreks.previousValue
    ) {
      this.createMap();
    } else {
      if (this.map) {
        const treksSource = this.map.getSource('treks-points') as GeoJSONSource;
        if (treksSource && this.filteredTreks) {
          treksSource.setData({
            type: 'FeatureCollection',
            features: this.filteredTreks
          });
        }
      }
    }
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }

    this.geolocate.stopTracking();

    super.ngOnDestroy();
  }

  createMap() {
    if (this.mapConfig && this.mapConfig.style && this.filteredTreks) {
      if (
        this.offline &&
        (this.platform.is('ios') || this.platform.is('android'))
      ) {
        (this.mapConfig.style as any).sources['tiles-background'].tiles[0] =
          this.commonSrc +
          (environment.offlineMapConfig.style as any).sources[
            'tiles-background'
          ].tiles[0];
      }

      const coordinates: number[][] = [];

      this.filteredTreks.forEach((feature) => {
        if (
          feature &&
          feature.geometry &&
          feature.geometry.coordinates &&
          feature.geometry.coordinates[0] &&
          feature.geometry.coordinates[1]
        ) {
          coordinates.push(feature.geometry.coordinates);
        }
      });

      const bounds: any = coordinates.reduce(
        (bounds, coord) => bounds.extend(coord),
        new mapboxgl.LngLatBounds(coordinates[0], coordinates[0])
      );

      this.map = new mapboxgl.Map({
        ...this.mapConfig,
        container: 'map-treks'
      });

      this.map.fitBounds(bounds, environment.map.TreksfitBoundsOptions);

      this.map.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        'top-left'
      );

      this.map.addControl(
        new mapboxgl.ScaleControl({
          unit: 'metric'
        })
      );

      this.map.addControl(
        new mapboxgl.AttributionControl({
          compact: false,
          customAttribution: environment.map.attributionText
        })
      );

      if (!environment.map.enableRotation) {
        this.map.dragRotate.disable();
        this.map.touchZoomRotate.disableRotation();
      }

      if (this.platform.is('ios') || this.platform.is('android')) {
        this.subscriptions$$.push(
          this.screenOrientation.onChange().subscribe(() => {
            // Need to delay before resize
            window.setTimeout(() => {
              this.map.resize();
            }, 50);
          })
        );
      }

      this.map.on('load', () => {
        const loadImages: Observable<any> = Observable.create(
          (observer: any) => {
            const practices: DataSetting | undefined = this.dataSettings.find(
              (data) => data.id === 'practice'
            );
            if (practices) {
              this.practices = practices;
              practices.values.forEach((practice, index: number) => {
                this.map.loadImage(
                  `${this.commonSrc}${practice.pictogram}`,
                  (error: any, image: any) => {
                    this.map.addImage(practice.id.toString(), image);
                    if (index + 1 === practices.values.length) {
                      observer.complete();
                    }
                  }
                );
              });
            }
          }
        );

        this.subscriptions$$.push(
          this.geolocate.currentPosition$.subscribe(async (coordinates) => {
            if (coordinates) {
              if (this.markerPosition) {
                this.markerPosition.setLngLat(coordinates);
              } else {
                const el = document.createElement('div');
                const currentHeading = await this.geolocate.checkIfCanGetCurrentHeading();
                el.className = currentHeading ? 'pulse-and-view' : 'pulse';

                this.markerPosition = new mapboxgl.Marker({
                  element: el
                }).setLngLat(coordinates);
                if (this.markerPosition) {
                  this.markerPosition.addTo(this.map);
                }
              }
            } else {
              if (this.markerPosition) {
                this.markerPosition.remove();
                this.markerPosition = undefined;
              }
            }
          }),
          this.geolocate.currentHeading$.subscribe((heading) => {
            if (this.markerPosition && heading) {
              (this.markerPosition as any).setRotation(heading);
            }
          }),
          loadImages.subscribe({
            complete: () => {
              this.addSourcesLayersEvents();
              this.geolocate.startTracking('');
            }
          })
        );
      });
    }
  }

  addSourcesLayersEvents() {
    this.map.addSource('treks-points', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: this.filteredTreks
      },
      maxzoom: this.mapConfig.maxZoom ? this.mapConfig.maxZoom + 1 : 18,
      cluster: true,
      clusterRadius: 50
    } as GeoJSONSourceRaw);

    this.map.addSource('zone', {
      type: 'geojson',
      data: 'assets/map/zone/zone.geojson'
    });

    this.map.addLayer({
      id: 'zone',
      source: 'zone',
      ...(environment.map.zoneLayerProperties as any)
    });

    this.map.addLayer({
      id: 'zone-outline',
      source: 'zone',
      ...(environment.map.zoneOutlineLayerProperties as any)
    });

    this.map.addLayer({
      id: 'clusters-circle',
      type: 'circle',
      source: 'treks-points',
      filter: ['has', 'point_count'],
      paint: environment.map.clusterPaint
    });

    this.map.addLayer({
      id: 'cluster-text-count',
      type: 'symbol',
      source: 'treks-points',
      filter: ['has', 'point_count'],
      paint: environment.map.clusterTextPaint,
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['Roboto Regular'],
        'text-size': 16,
        'text-offset': [0, 0.1]
      }
    });

    const circleColorExpression: any[] = [];
    circleColorExpression.push('match');
    circleColorExpression.push(['get', 'practice']);
    this.practices.values.forEach((practice) => {
      circleColorExpression.push(practice.id);
      circleColorExpression.push(practice.color);
    });
    circleColorExpression.push(environment.map.clusterPaint['circle-color']);

    this.map.addLayer({
      id: 'trek-point',
      type: 'circle',
      source: 'treks-points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        ...environment.map.clusterPaint,
        'circle-color': circleColorExpression as any,
        'circle-radius': 16
      }
    });

    this.map.addLayer({
      id: 'trek-point-icon',
      type: 'symbol',
      source: 'treks-points',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['get', 'practice'],
        'icon-size': environment.map.globalMapIconSize
      }
    });

    this.map.on('click', 'clusters-circle', (e) => {
      const features = this.map.queryRenderedFeatures(e.point, {
        layers: ['clusters-circle']
      });

      const featureProperties = features[0].properties;
      if (!!featureProperties) {
        const clusterId = featureProperties.cluster_id;

        if (this.map.getZoom() === this.mapConfig.maxZoom) {
          // no more zoom, display features inside cluster
          (this.map.getSource(
            'treks-points'
          ) as GeoJSONSource).getClusterLeaves(
            featureProperties.cluster_id,
            Infinity,
            0,
            (
              err: any,
              featuresInCluster: Feature<Geometry, GeoJsonProperties>[]
            ) => {
              if (err) {
                throw err;
              }
              this.presentConfirmFeatures(
                featuresInCluster as Feature<
                  Geometry,
                  { [name: string]: any }
                >[]
              );
            }
          );
        } else {
          // zoom to next cluster expansion
          (this.map.getSource(
            'treks-points'
          ) as GeoJSONSource).getClusterExpansionZoom(
            clusterId,
            (err: any, zoom: number) => {
              if (err) {
                return;
              }
              const coordinates = (features[0].geometry as Point).coordinates;
              this.map.easeTo({
                center: [coordinates[0], coordinates[1]],
                zoom: zoom
              });
            }
          );
        }
      }
    });

    this.map.on('click', 'trek-point', (e) => {
      const feature = this.map.queryRenderedFeatures(e.point, {
        layers: ['trek-point']
      })[0];
      if (!!feature.properties) {
        this.navigateToTrek.emit(feature.properties.id);
      }
    });

    // map instance for cypress test
    this.mapViz.nativeElement.mapInstance = this.map;

    this.mapIsLoaded.emit(true);
  }

  async presentConfirmFeatures(
    features: Feature<Geometry, { [name: string]: any }>[]
  ) {
    const radioTreks: {
      id: number;
      name: string;
      imgPractice: { src: string; color: string | undefined };
    }[] = [];

    features.forEach((feature) => {
      const hydratedTrek = this.settings.getHydratedTrek(feature as Trek);
      const trek = {
        id: hydratedTrek.properties.id,
        name: hydratedTrek.properties.name,
        imgPractice: {
          src: this.commonSrc + hydratedTrek.properties.practice.pictogram,
          color: hydratedTrek.properties.practice.color
        }
      };
      radioTreks.push(trek);
    });

    const modal = await this.modalController.create({
      component: SelectTrekComponent,
      componentProps: { radioTreks },
      cssClass: 'full-size'
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data && data.selectedTrekId) {
      this.navigateToTrek.emit(data.selectedTrekId);
    }
  }

  /**
   * Fly to user location else fitbounds to trek
   */
  public async flyToUserLocation() {
    const userLocation = await this.geolocate.getCurrentPosition();
    if (userLocation) {
      this.map.flyTo({
        center: [userLocation.longitude, userLocation.latitude],
        animate: false,
        zoom: environment.trekZoom.zoom
      });
    } else {
      const errorTranslation: any = await this.translate
        .get('geolocate.error')
        .toPromise();
      // Inform user about problem
      const alertLocation = await this.alertController.create({
        header: errorTranslation['header'],
        subHeader: errorTranslation['subHeader'],
        message: errorTranslation['message'],
        buttons: [errorTranslation['confirmButton']]
      });

      await alertLocation.present();
    }
  }
}
