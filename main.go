package main

import (
	"embed"
	"log"

	"github.com/denveous/session-shelf/internal/shelf"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	service, err := shelf.NewService()
	if err != nil {
		log.Fatal(err)
	}
	app := application.New(application.Options{
		Name:        "Session Shelf",
		Description: "Local Codex session storage manager",
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		Mac:    application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Session Shelf",
		Width:            1440,
		Height:           900,
		MinWidth:         1100,
		MinHeight:        650,
		Frameless:        true,
		BackgroundColour: application.NewRGB(11, 16, 32),
		Windows: application.WindowsWindow{
			NonClientRegionSupport: true,
		},
		URL:              "/",
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
