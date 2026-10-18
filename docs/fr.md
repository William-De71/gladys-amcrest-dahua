# Amcrest / Dahua

## Présentation

Cette intégration amène dans Gladys les caméras, sonnettes et enregistreurs basés sur un **firmware Dahua** : Dahua, Amcrest, Lorex, Imou, EmpireTech et les nombreux modèles renommés qui partagent la même interface web. Tout se passe **sur votre réseau local** : aucun compte cloud, aucune donnée ne sort de chez vous.

Chaque caméra devient un appareil Gladys (un enregistreur donne un appareil par caméra qu’il enregistre) :

| Fonctionnalité         | Quand                                         | Type Gladys                 |
| ---------------------- | --------------------------------------------- | --------------------------- |
| Image                  | toujours                                      | `camera` / `image`          |
| Vidéo en direct        | toujours (RTSP, flux principal ou secondaire) | widget caméra               |
| Mouvement              | toujours                                      | `motion-sensor` / `binary`  |
| Personne, Véhicule     | détection de mouvement intelligente (SMD)     | `motion-sensor` / `binary`  |
| Franchissement         | une règle IVS « franchissement de ligne »     | `motion-sensor` / `binary`  |
| Intrusion              | une règle IVS « intrusion »                   | `motion-sensor` / `binary`  |
| Sonnette               | VTO, Amcrest AD110 / AD410, Imou DB61i…       | `doorbell` / `ring`         |
| Détection de mouvement | la caméra sait l’activer ou la couper         | `switch` / `binary`         |
| Caméra activée         | mode privé (Amcrest, Imou)                    | `camera` / `enabled`        |
| Déplacement, Position  | caméras PTZ                                   | `camera` / `move`, `preset` |

Les détections sont **instantanées** : l’intégration garde ouvert le flux d’événements de chaque appareil, comme le font les applications officielles.

**Transport** : local uniquement. Les caméras sont jointes par leur API HTTP (`/cgi-bin`) et en RTSP ; rien ne passe par le cloud de la marque, et le catalogue affiche le badge « local ».

## Prérequis

- Gladys **5.1.0** ou plus récent (widgets de tableau de bord, déclencheurs et actions de scène).
- Une caméra, une sonnette ou un enregistreur sous firmware Dahua, joignable depuis Gladys, avec **HTTP** activé (c’est le cas par défaut) et **RTSP** activé pour la vidéo en direct.
- Le compte que vous utilisez dans son interface web (`admin` dans la plupart des installations).
- Pour la détection de personnes et de véhicules : une caméra avec **détection de mouvement intelligente (SMD)** ou des règles **IVS**, activées dans son interface web (Événement → Smart Motion Detection, ou Événement → IVS).

## Configuration

1. Installez l’intégration depuis le store.
2. Renseignez l’**identifiant** et le **mot de passe** de vos caméras, puis enregistrez.
3. Ouvrez l’onglet **Découverte** et lancez un scan : les appareils de votre réseau répondent d’eux-mêmes (découverte DHIP, le protocole de l’outil ConfigTool de Dahua). Ajoutez les caméras voulues.
4. Cliquez sur **Tester la connexion** pour voir, pour chaque appareil, son modèle, ses caméras et ce qu’elles savent faire.

| Champ                       | Par défaut | Rôle                                                                                                             |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Identifiant                 | `admin`    | Le compte de l’interface web                                                                                     |
| Mot de passe                | —          | Son mot de passe. Cinq mots de passe erronés bloquent le compte 30 minutes sur la caméra                         |
| Rafraîchissement des images | 60         | Une nouvelle image pour le tableau de bord toutes les N secondes (10 à 3600, 0 = à la demande et aux détections) |
| Image à chaque détection    | oui        | Une image au début d’un mouvement, d’une personne, d’un véhicule ou d’un appui sur la sonnette                   |
| Flux de la vidéo en direct  | principal  | Flux principal (pleine résolution) ou secondaire (plus léger)                                                    |
| Adresses des appareils      | —          | Pour un appareil que le scan ne trouve pas : `192.168.1.108, 192.168.1.20:8080, https://192.168.1.30`            |
| Comptes par appareil        | —          | Pour un appareil avec un autre compte : `adresse\|identifiant\|motdepasse`, séparés par des virgules             |

Un enregistreur (NVR, DVR, XVR) donne un appareil par caméra activée ; les sonnettes et les caméras un appareil chacune.

## Utilisation

### Tableau de bord

Ajoutez une boîte **Caméra** pour l’image et la vidéo en direct, et les widgets de l’intégration :

![Les widgets Caméras, Détections et Stockage d’enregistrement (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-amcrest-dahua/main/docs/assets/widgets.fr.png)

- **Caméras** : combien de caméras envoient leurs événements, les détections des dernières 24 heures, l’état et la dernière détection de chaque caméra, et un bouton pour rafraîchir toutes les images.
- **Détections** : les dernières détections, de la plus récente à la plus ancienne, avec l’image prise à ce moment-là (toutes les caméras, ou une seule).
- **Stockage d’enregistrement** : la carte SD ou les disques d’une caméra ou d’un enregistreur : utilisé, libre, capacité, santé.

### Scènes

Déclencheurs :

- **Détection** : mouvement, personne, véhicule, ligne franchie, intrusion, son, sabotage ou sonnette pressée, filtrés par caméra et par type. Variables : nom de la caméra, type, nom de la règle IVS, type d’objet.
- **Alarme** : vidéo perdue, entrée d’alarme, panne de stockage, stockage presque plein, aucun stockage.
- **Caméra injoignable** et **Caméra revenue**.

Actions :

- **Prendre une image** : une image fraîche, prête pour l’action « envoyer l’image de la caméra » qui suit.
- **Mode d’enregistrement** : toujours enregistrer, suivre le planning de la caméra, ou ne pas enregistrer.
- **Ouvrir la porte** : la gâche reliée à une platine de rue Dahua (VTO).
- **Redémarrer**.

Exemples :

- Quand la sonnette est pressée → prendre une image de la porte d’entrée → l’envoyer à la famille et allumer l’entrée.
- Quand une personne est détectée dans le jardin la nuit et que personne n’est à la maison → allumer les lumières du jardin et envoyer l’image.
- Quand la dernière personne quitte la maison → mode d’enregistrement « toujours enregistrer » ; quand quelqu’un arrive → « planning de la caméra ».

## Dépannage

- **« Mot de passe refusé »** : vérifiez le compte dans l’interface web de la caméra. Après un refus, l’intégration attend dix minutes avant de redemander (la caméra bloque le compte 30 minutes après cinq échecs) ; corrigez le mot de passe puis cliquez sur **Tester la connexion**.
- **Un appareil n’est pas trouvé par le scan** : la découverte passe par un broadcast UDP sur le port 37810, qui ne traverse ni les VLAN ni certaines isolations Wi-Fi. Saisissez son adresse dans **Adresses des appareils**.
- **Aucune réponse d’une adresse** : HTTP est peut-être désactivé ou sur un autre port (Réseau → Port dans l’interface web) ; ajoutez `:port`, ou `https://` si seul HTTPS est activé.
- **Pas de vidéo en direct** : RTSP doit être activé (Réseau → Port → RTSP, port 554 par défaut) ; après un changement de flux ou de mot de passe, relancez un scan pour mettre à jour l’adresse de la vidéo.
- **Pas de capteur Personne ou Véhicule** : activez la détection de mouvement intelligente ou une règle IVS dans la caméra, puis relancez un scan (une fonctionnalité n’est ajoutée que par un scan).
- **Appuis sur la sonnette non vus** : certains firmwares VTO n’envoient l’appui que par leur propre protocole DHIP, pas en HTTP ; ouvrez une issue avec le modèle et le firmware.
- Journaux : l’onglet **Supervision** de l’intégration. Signalez les problèmes sur GitHub avec les versions de Gladys et de l’intégration, le modèle et le firmware de l’appareil, et le résultat de **Tester la connexion**.
