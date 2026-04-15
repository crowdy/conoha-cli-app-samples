package cmd

import (
	"fish-speech-cli/client"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

func NewRefCmd(getServer func() string) *cobra.Command {
	refCmd := &cobra.Command{
		Use:   "ref",
		Short: "Manage reference voices",
	}

	// ref list
	refCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List all reference voices",
		RunE: func(cmd *cobra.Command, args []string) error {
			c := client.New(getServer())
			resp, err := c.ListRefs()
			if err != nil {
				return err
			}
			if len(resp.ReferenceIDs) == 0 {
				fmt.Println("No reference voices found")
				return nil
			}
			for _, id := range resp.ReferenceIDs {
				fmt.Println(id)
			}
			return nil
		},
	})

	// ref add
	var addName, addFile, addText string
	addCmd := &cobra.Command{
		Use:   "add",
		Short: "Add a reference voice",
		Example: `  fish-speech-cli ref add --name my-voice --file voice.wav --text "transcript of the audio"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if addName == "" || addFile == "" || addText == "" {
				return fmt.Errorf("--name, --file, and --text are all required")
			}

			f, err := os.Open(addFile)
			if err != nil {
				return fmt.Errorf("open audio file: %w", err)
			}
			defer f.Close()

			c := client.New(getServer())
			resp, err := c.AddRef(addName, addText, f, filepath.Base(addFile))
			if err != nil {
				return err
			}
			fmt.Printf("Added reference voice: %s\n", resp.ReferenceID)
			return nil
		},
	}
	addCmd.Flags().StringVar(&addName, "name", "", "Reference voice name (required)")
	addCmd.Flags().StringVar(&addFile, "file", "", "Audio file path (required)")
	addCmd.Flags().StringVar(&addText, "text", "", "Transcript of the audio (required)")
	refCmd.AddCommand(addCmd)

	// ref delete
	var deleteName string
	deleteCmd := &cobra.Command{
		Use:   "delete",
		Short: "Delete a reference voice",
		Example: `  fish-speech-cli ref delete --name my-voice`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if deleteName == "" {
				return fmt.Errorf("--name is required")
			}
			c := client.New(getServer())
			resp, err := c.DeleteRef(deleteName)
			if err != nil {
				return err
			}
			fmt.Printf("Deleted reference voice: %s\n", resp.ReferenceID)
			return nil
		},
	}
	deleteCmd.Flags().StringVar(&deleteName, "name", "", "Reference voice name to delete (required)")
	refCmd.AddCommand(deleteCmd)

	// ref update
	var updateOld, updateNew string
	updateCmd := &cobra.Command{
		Use:   "update",
		Short: "Rename a reference voice",
		Example: `  fish-speech-cli ref update --old my-voice --new new-voice`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if updateOld == "" || updateNew == "" {
				return fmt.Errorf("--old and --new are both required")
			}
			c := client.New(getServer())
			resp, err := c.UpdateRef(updateOld, updateNew)
			if err != nil {
				return err
			}
			fmt.Printf("Renamed reference voice: %s -> %s\n", resp.OldReferenceID, resp.NewReferenceID)
			return nil
		},
	}
	updateCmd.Flags().StringVar(&updateOld, "old", "", "Current reference voice name (required)")
	updateCmd.Flags().StringVar(&updateNew, "new", "", "New reference voice name (required)")
	refCmd.AddCommand(updateCmd)

	return refCmd
}
