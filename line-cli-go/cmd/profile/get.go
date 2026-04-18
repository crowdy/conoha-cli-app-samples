package profile

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get a user's profile",
	RunE: func(cmd *cobra.Command, args []string) error {
		userID, _ := cmd.Flags().GetString("user-id")
		if userID == "" {
			return fmt.Errorf("--user-id is required")
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.GetProfile(userID)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"userId":        resp.UserId,
			"displayName":   resp.DisplayName,
			"pictureUrl":    resp.PictureUrl,
			"statusMessage": resp.StatusMessage,
			"language":      resp.Language,
		})
		return nil
	},
}

func init() {
	getCmd.Flags().String("user-id", "", "LINE user ID (required)")
}
